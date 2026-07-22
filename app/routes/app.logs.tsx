import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Form, useLoaderData, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
import { Prisma } from "@prisma/client";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ACTION_LABELS, describeChange } from "../lib/log-display";

const PAGE_SIZE = 20;

type LatestLogRow = {
  productId: string;
  productTitle: string | null;
  action: string;
  actor: string | null;
  createdAt: Date;
};

type ProductSummary = {
  productId: string;
  productTitle: string | null;
  lastAction: string;
  lastActor: string | null;
  lastCreatedAt: string;
  changeCount: number;
  history: {
    id: string;
    action: string;
    field: string | null;
    oldValue: string | null;
    newValue: string | null;
    collectionTitle: string | null;
    source: string;
    actor: string | null;
    createdAt: string;
  }[];
};

async function summarize(
  shop: string,
  latestRows: LatestLogRow[],
): Promise<ProductSummary[]> {
  const productIds = latestRows.map((row) => row.productId);
  if (productIds.length === 0) return [];

  const [counts, history] = await Promise.all([
    db.productLog.groupBy({
      by: ["productId"],
      where: { shop, productId: { in: productIds } },
      _count: { id: true },
    }),
    db.productLog.findMany({
      where: { shop, productId: { in: productIds } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const countByProductId = new Map(counts.map((c) => [c.productId, c._count.id]));
  const historyByProductId = new Map<string, typeof history>();
  for (const log of history) {
    const list = historyByProductId.get(log.productId) ?? [];
    list.push(log);
    historyByProductId.set(log.productId, list);
  }

  return latestRows.map((row) => ({
    productId: row.productId,
    productTitle: row.productTitle,
    lastAction: row.action,
    lastActor: row.actor,
    lastCreatedAt: row.createdAt.toISOString(),
    changeCount: countByProductId.get(row.productId) ?? 0,
    history: (historyByProductId.get(row.productId) ?? []).map((log) => ({
      id: log.id,
      action: log.action,
      field: log.field,
      oldValue: log.oldValue,
      newValue: log.newValue,
      collectionTitle: log.collectionTitle,
      source: log.source,
      actor: log.actor,
      createdAt: log.createdAt.toISOString(),
    })),
  }));
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const search = url.searchParams.get("q")?.trim() ?? "";
  const skip = (page - 1) * PAGE_SIZE;
  const searchPattern = `%${search}%`;

  const pinned = await db.pinnedProduct.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
  });
  const pinnedIds = pinned.map((p) => p.productId);
  const excludePinned = pinnedIds.length
    ? Prisma.sql`AND "productId" NOT IN (${Prisma.join(pinnedIds)})`
    : Prisma.empty;

  const [totalRows, latestPerProduct, pinnedLatestRows] = await Promise.all([
    db.productLog.groupBy({
      by: ["productId"],
      where: {
        shop,
        productId: { notIn: pinnedIds },
        OR: [
          { productTitle: { contains: search, mode: "insensitive" } },
          { productId: { contains: search, mode: "insensitive" } },
        ],
      },
    }),
    db.$queryRaw<LatestLogRow[]>`
      SELECT * FROM (
        SELECT DISTINCT ON ("productId") "productId", "productTitle", "action", "actor", "createdAt"
        FROM "ProductLog"
        WHERE "shop" = ${shop}
          AND ("productTitle" ILIKE ${searchPattern} OR "productId" ILIKE ${searchPattern})
          ${excludePinned}
        ORDER BY "productId", "createdAt" DESC
      ) latest
      ORDER BY "createdAt" DESC
      LIMIT ${PAGE_SIZE} OFFSET ${skip}
    `,
    pinnedIds.length
      ? db.$queryRaw<LatestLogRow[]>`
          SELECT DISTINCT ON ("productId") "productId", "productTitle", "action", "actor", "createdAt"
          FROM "ProductLog"
          WHERE "shop" = ${shop} AND "productId" IN (${Prisma.join(pinnedIds)})
          ORDER BY "productId", "createdAt" DESC
        `
      : Promise.resolve([]),
  ]);

  const totalProducts = totalRows.length;

  const pinnedOrder = new Map(pinnedIds.map((id, index) => [id, index]));
  pinnedLatestRows.sort(
    (a, b) => (pinnedOrder.get(a.productId) ?? 0) - (pinnedOrder.get(b.productId) ?? 0),
  );

  const [products, pinnedProducts] = await Promise.all([
    summarize(shop, latestPerProduct),
    summarize(shop, pinnedLatestRows),
  ]);

  return {
    products,
    pinnedProducts,
    page,
    search,
    totalProducts,
    hasNextPage: skip + products.length < totalProducts,
    hasPreviousPage: page > 1,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const formData = await request.formData();
  const intent = formData.get("intent");
  const productId = String(formData.get("productId") ?? "");
  if (!productId) return { ok: false };

  if (intent === "pin") {
    await db.pinnedProduct.upsert({
      where: { shop_productId: { shop, productId } },
      create: { shop, productId },
      update: {},
    });
  } else if (intent === "unpin") {
    await db.pinnedProduct.deleteMany({ where: { shop, productId } });
  }

  return { ok: true };
};

function ProductRow({
  product,
  pinned,
  onView,
}: {
  product: ProductSummary;
  pinned: boolean;
  onView: (productId: string) => void;
}) {
  const modalId = `history-${product.productId}`;

  return (
    <s-table-row clickDelegate={`open-${product.productId}`}>
      <s-table-cell>
        <s-link
          id={`open-${product.productId}`}
          command="--show"
          commandFor={modalId}
        >
          {product.productTitle ?? product.productId}
        </s-link>
      </s-table-cell>
      <s-table-cell>{ACTION_LABELS[product.lastAction] ?? product.lastAction}</s-table-cell>
      <s-table-cell>{product.lastActor ?? "—"}</s-table-cell>
      <s-table-cell>{new Date(product.lastCreatedAt).toLocaleString()}</s-table-cell>
      <s-table-cell>{product.changeCount}</s-table-cell>
      <s-table-cell>
        <s-button variant="tertiary" onClick={() => onView(product.productId)}>
          View product
        </s-button>
      </s-table-cell>
      <s-table-cell>
        <Form method="post" reloadDocument>
          <input type="hidden" name="productId" value={product.productId} />
          <input type="hidden" name="intent" value={pinned ? "unpin" : "pin"} />
          <s-button
            type="submit"
            variant="tertiary"
            icon={pinned ? "pin-remove" : "pin"}
          >
            {pinned ? "Unpin" : "Pin"}
          </s-button>
        </Form>
      </s-table-cell>
    </s-table-row>
  );
}

export default function Logs() {
  const { products, pinnedProducts, page, search, totalProducts, hasNextPage, hasPreviousPage } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const shopify = useAppBridge();

  const viewProduct = (productId: string) => {
    shopify.intents.invoke?.("edit:shopify/Product", {
      value: `gid://shopify/Product/${productId}`,
    });
  };

  // Full-document navigation (not React Router's client-side navigate())
  // on purpose: if the embedded session token happens to be stale on a
  // client-side data fetch, the Shopify SDK throws an iframe-breakout HTML
  // response that React Router v7's client data pipeline can't parse,
  // rendering a bare "200" instead of the page. A hard navigation always
  // goes through a fresh server-rendered document, sidestepping that path.
  const goToPage = (nextPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(nextPage));
    window.location.href = `/app/logs?${params.toString()}`;
  };

  const runSearch = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("q", value);
    } else {
      params.delete("q");
    }
    params.set("page", "1");
    window.location.href = `/app/logs?${params.toString()}`;
  };

  const allProducts = [...pinnedProducts, ...products];

  return (
    <s-page heading="Product logs">
      {pinnedProducts.length > 0 && (
        <s-section heading={`Pinned (${pinnedProducts.length})`}>
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Last activity</s-table-header>
              <s-table-header>Changed by</s-table-header>
              <s-table-header>Last updated</s-table-header>
              <s-table-header>Changes</s-table-header>
              <s-table-header>View product</s-table-header>
              <s-table-header>Pin</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {pinnedProducts.map((product) => (
                <ProductRow
                  key={product.productId}
                  product={product}
                  pinned
                  onView={viewProduct}
                />
              ))}
            </s-table-body>
          </s-table>
        </s-section>
      )}

      <s-section heading={`Products with activity (${totalProducts})`}>
        <s-search-field
          label="Search products"
          labelAccessibilityVisibility="exclusive"
          placeholder="Search by product name or ID"
          value={search}
          onChange={(event) => runSearch(event.currentTarget.value)}
        />
        {products.length === 0 ? (
          <s-paragraph>
            {search
              ? `No products match "${search}".`
              : "No product activity has been logged yet. Changes to products and collections will show up here as they happen."}
          </s-paragraph>
        ) : (
          <s-table
            variant="auto"
            paginate
            hasNextPage={hasNextPage}
            hasPreviousPage={hasPreviousPage}
            onNextPage={() => goToPage(page + 1)}
            onPreviousPage={() => goToPage(page - 1)}
          >
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Last activity</s-table-header>
              <s-table-header>Changed by</s-table-header>
              <s-table-header>Last updated</s-table-header>
              <s-table-header>Changes</s-table-header>
              <s-table-header>View product</s-table-header>
              <s-table-header>Pin</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {products.map((product) => (
                <ProductRow
                  key={product.productId}
                  product={product}
                  pinned={false}
                  onView={viewProduct}
                />
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {allProducts.map((product) => {
        const modalId = `history-${product.productId}`;
        return (
          <s-modal
            key={modalId}
            id={modalId}
            heading={product.productTitle ?? product.productId}
          >
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header>Time</s-table-header>
                <s-table-header>Action</s-table-header>
                <s-table-header>Detail</s-table-header>
                <s-table-header>Changed by</s-table-header>
                <s-table-header>Source</s-table-header>
              </s-table-header-row>
              <s-table-body>
                {product.history.map((log) => (
                  <s-table-row key={log.id}>
                    <s-table-cell>
                      {new Date(log.createdAt).toLocaleString()}
                    </s-table-cell>
                    <s-table-cell>
                      {ACTION_LABELS[log.action] ?? log.action}
                    </s-table-cell>
                    <s-table-cell>{describeChange(log)}</s-table-cell>
                    <s-table-cell>{log.actor ?? "—"}</s-table-cell>
                    <s-table-cell>{log.source}</s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
            <s-button slot="secondary-actions" command="--hide" commandFor={modalId}>
              Close
            </s-button>
          </s-modal>
        );
      })}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
