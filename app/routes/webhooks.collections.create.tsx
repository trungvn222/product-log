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

  if (!admin) {
    console.warn(`No admin session for ${shop}, skipping collection sync`);
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
    // Brand new collection: going from "doesn't exist" to having these
    // products IS a real addition, unlike the /update case for a
    // pre-existing collection we're just seeing for the first time.
    treatMissingSnapshotAsAdditions: true,
  });

  return new Response();
};
