import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  const productId = String(payload.id);

  const snapshot = await db.productSnapshot.findUnique({
    where: { shop_productId: { shop, productId } },
  });
  const productTitle = snapshot
    ? (JSON.parse(snapshot.data).title ?? null)
    : null;

  await db.$transaction([
    db.productLog.create({
      data: {
        shop,
        productId,
        productTitle,
        action: "deleted",
        source: topic,
      },
    }),
    db.productSnapshot.deleteMany({ where: { shop, productId } }),
  ]);

  return new Response();
};
