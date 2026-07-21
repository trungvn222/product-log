import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ACTION_LABELS, describeChange } from "../lib/log-display";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const logs = await db.productLog.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });

  const products = new Map<
    string,
    {
      productId: string;
      productTitle: string | null;
      changeCount: number;
      lastAction: string;
      lastCreatedAt: string;
      lastActor: string | null;
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
    }
  >();

  for (const log of logs) {
    let group = products.get(log.productId);
    if (!group) {
      group = {
        productId: log.productId,
        productTitle: log.productTitle,
        changeCount: 0,
        lastAction: log.action,
        lastCreatedAt: log.createdAt.toISOString(),
        lastActor: log.actor,
        history: [],
      };
      products.set(log.productId, group);
    }
    group.changeCount += 1;
    if (!group.productTitle && log.productTitle) {
      group.productTitle = log.productTitle;
    }
    group.history.push({
      id: log.id,
      action: log.action,
      field: log.field,
      oldValue: log.oldValue,
      newValue: log.newValue,
      collectionTitle: log.collectionTitle,
      source: log.source,
      actor: log.actor,
      createdAt: log.createdAt.toISOString(),
    });
  }

  return { products: [...products.values()] };
};

export default function Logs() {
  const { products } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Product logs">
      <s-section heading={`Products with activity (${products.length})`}>
        {products.length === 0 ? (
          <s-paragraph>
            No product activity has been logged yet. Changes to products and
            collections will show up here as they happen.
          </s-paragraph>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header>Product</s-table-header>
              <s-table-header>Last activity</s-table-header>
              <s-table-header>Changed by</s-table-header>
              <s-table-header>Last updated</s-table-header>
              <s-table-header>Changes</s-table-header>
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
