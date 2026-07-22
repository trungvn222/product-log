import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigate, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useAppBridge } from "@shopify/app-bridge-react";
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

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const search = url.searchParams.get("q")?.trim() ?? "";
  const skip = (page - 1) * PAGE_SIZE;
  const searchPattern = `%${search}%`;

  const [totalRows, latestPerProduct] = await Promise.all([
    db.productLog.groupBy({
      by: ["productId"],
      where: {
        shop,
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
        ORDER BY "productId", "createdAt" DESC
      ) latest
      ORDER BY "createdAt" DESC
      LIMIT ${PAGE_SIZE} OFFSET ${skip}
    `,
  ]);

  const totalProducts = totalRows.length;
  const pageProductIds = latestPerProduct.map((row) => row.productId);

  const [counts, history] = await Promise.all([
    pageProductIds.length
      ? db.productLog.groupBy({
          by: ["productId"],
          where: { shop, productId: { in: pageProductIds } },
          _count: { id: true },
        })
      : Promise.resolve([]),
    pageProductIds.length
      ? db.productLog.findMany({
          where: { shop, productId: { in: pageProductIds } },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([]),
  ]);

  const countByProductId = new Map(counts.map((c) => [c.productId, c._count.id]));
  const historyByProductId = new Map<string, typeof history>();
  for (const log of history) {
    const list = historyByProductId.get(log.productId) ?? [];
    list.push(log);
    historyByProductId.set(log.productId, list);
  }

  const products = latestPerProduct.map((row) => ({
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

  return {
    products,
    page,
    search,
    totalProducts,
    hasNextPage: skip + products.length < totalProducts,
    hasPreviousPage: page > 1,
  };
};

export default function Logs() {
  const { products, page, search, totalProducts, hasNextPage, hasPreviousPage } =
    useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shopify = useAppBridge();

  const viewProduct = (productId: string) => {
    shopify.intents.invoke?.("edit:shopify/Product", {
      value: `gid://shopify/Product/${productId}`,
    });
  };

  const goToPage = (nextPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", String(nextPage));
    navigate(`/app/logs?${params.toString()}`);
  };

  const runSearch = (value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("q", value);
    } else {
      params.delete("q");
    }
    params.set("page", "1");
    navigate(`/app/logs?${params.toString()}`);
  };

  return (
    <s-page heading="Product logs">
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
            </s-table-header-row>
            <s-table-body>
              {products.map((product) => {
                const modalId = `history-${product.productId}`;
                return (
                  <s-table-row
                    key={product.productId}
                    clickDelegate={`open-${product.productId}`}
                  >
                    <s-table-cell>
                      <s-link
                        id={`open-${product.productId}`}
                        command="--show"
                        commandFor={modalId}
                      >
                        {product.productTitle ?? product.productId}
                      </s-link>
                    </s-table-cell>
                    <s-table-cell>
                      {ACTION_LABELS[product.lastAction] ?? product.lastAction}
                    </s-table-cell>
                    <s-table-cell>{product.lastActor ?? "—"}</s-table-cell>
                    <s-table-cell>
                      {new Date(product.lastCreatedAt).toLocaleString()}
                    </s-table-cell>
                    <s-table-cell>{product.changeCount}</s-table-cell>
                    <s-table-cell>
                      <s-button
                        variant="tertiary"
                        onClick={() => viewProduct(product.productId)}
                      >
                        View product
                      </s-button>
                    </s-table-cell>
                  </s-table-row>
                );
              })}
            </s-table-body>
          </s-table>
        )}
      </s-section>

      {products.map((product) => {
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
