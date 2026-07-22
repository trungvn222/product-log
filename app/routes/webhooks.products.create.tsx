import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { fetchLatestActor } from "../lib/event-actor.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);

  const productId = String(payload.id);
  const productTitle = (payload.title as string) ?? null;
  const productImage =
    ((payload.image as { src?: string } | null)?.src as string | undefined) ?? null;
  const gid =
    (payload.admin_graphql_api_id as string) ??
    `gid://shopify/Product/${productId}`;

  const actor = admin ? await fetchLatestActor(admin, "product", gid) : null;

  await db.$transaction([
    db.productLog.create({
      data: {
        shop,
        productId,
        productTitle,
        productImage,
        action: "created",
        source: topic,
        actor,
      },
    }),
    db.productSnapshot.upsert({
      where: { shop_productId: { shop, productId } },
      create: { shop, productId, data: JSON.stringify(payload) },
      update: { data: JSON.stringify(payload) },
    }),
  ]);

  return new Response();
};
