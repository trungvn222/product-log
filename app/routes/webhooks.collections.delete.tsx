import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import type { SnapshotProduct } from "../lib/collection-sync.server";

type CollectionPayload = {
  id: number | string;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  const collection = payload as unknown as CollectionPayload;
  const collectionId = String(collection.id);

  const snapshot = await db.collectionSnapshot.findUnique({
    where: { shop_collectionId: { shop, collectionId } },
  });

  if (!snapshot) {
    return new Response();
  }

  const products: SnapshotProduct[] = JSON.parse(snapshot.productIds);

  // CollectionSnapshot doesn't store the collection's title; reuse it from
  // the last log entry we recorded for this collection, if any.
  const lastLogForCollection = await db.productLog.findFirst({
    where: { shop, collectionId },
    orderBy: { createdAt: "desc" },
  });
  const collectionTitle = lastLogForCollection?.collectionTitle ?? null;

  await db.$transaction([
    ...products.map((p) =>
      db.productLog.create({
        data: {
          shop,
          productId: p.id,
          productTitle: p.title,
          action: "removed_from_collection",
          collectionId,
          collectionTitle,
          source: topic,
        },
      }),
    ),
    db.collectionSnapshot.delete({
      where: { shop_collectionId: { shop, collectionId } },
    }),
  ]);

  return new Response();
};
