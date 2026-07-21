import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { fetchCollectionProducts, syncCollectionSnapshot } from "../lib/collection-sync.server";
import { fetchLatestActor } from "../lib/event-actor.server";

type CollectionPayload = {
  id: number | string;
  title?: string;
  admin_graphql_api_id?: string;
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`, payload);
  const collection = payload as unknown as CollectionPayload;
  const collectionId = String(collection.id);
  const collectionTitle = collection.title ?? null;

  // Webhook payload doesn't include the product diff, so fetch current
  // membership and compare against the last known snapshot.
  if (!admin) {
    console.warn(`No admin session for ${shop}, skipping collection diff`);
    return new Response();
  }

  const gid =
    collection.admin_graphql_api_id ?? `gid://shopify/Collection/${collectionId}`;

  const { title, products } = await fetchCollectionProducts(admin, gid);
  console.log(`Collection ${gid}: found=${!!title}, productCount=${products.length}`);
  const actor = await fetchLatestActor(admin, "collection", gid);

  await syncCollectionSnapshot({
    shop,
    collectionId,
    collectionTitle: title ?? collectionTitle,
    source: topic,
    currentProducts: products,
    actor,
    // A collection whose first observed event is /update has almost
    // certainly existed for a while — its current members aren't newly
    // added, so just seed a silent baseline (see collections.create.tsx for
    // the genuinely-new-collection case).
    treatMissingSnapshotAsAdditions: false,
  });

  return new Response();
};
