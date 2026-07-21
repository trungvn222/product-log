import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { ACTION_LABELS, describeChange } from "../lib/log-display";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const productId = params.productId!;

  const logs = await db.productLog.findMany({
    where: { shop: session.shop, productId },
    orderBy: { createdAt: "desc" },
  });

  const productTitle = logs.find((l) => l.productTitle)?.productTitle ?? null;

  return {
    productId,
    productTitle,
    logs: logs.map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString(),
    })),
  };
};

export default function ProductLogHistory() {
  const { productId, productTitle, logs } = useLoaderData<typeof loader>();

  return (
    <s-page heading={productTitle ?? productId}>
      <s-link slot="breadcrumb-actions" href="/app/logs">
        Product logs
      </s-link>
      <s-section heading={`History (${logs.length})`}>
        {logs.length === 0 ? (
          <s-paragraph>No activity logged for this product.</s-paragraph>
        ) : (
          <s-table variant="auto">
            <s-table-header-row>
              <s-table-header>Time</s-table-header>
              <s-table-header>Action</s-table-header>
              <s-table-header>Detail</s-table-header>
              <s-table-header>Changed by</s-table-header>
              <s-table-header>Source</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {logs.map((log) => (
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
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
