import { authenticate } from "../shopify.server";
import db from "../db.server";

type AdminClient = NonNullable<
  Awaited<ReturnType<typeof authenticate.webhook>>["admin"]
>;

export type SnapshotProduct = { id: string; title: string };

// Product ids from products/create|update|delete webhooks are the legacy
// numeric REST id (e.g. "1001"). GraphQL returns the full GID
// (gid://shopify/Product/1001) — normalize to the numeric id so a product's
// history stays under one consistent productId across every webhook source.
export function numericIdFromGid(gid: string): string {
  return gid.split("/").pop() ?? gid;
}

export async function fetchCollectionProducts(admin: AdminClient, gid: string) {
  const response = await admin.graphql(
    `#graphql
      query CollectionProducts($id: ID!) {
        collection(id: $id) {
          title
          products(first: 250) {
            edges {
              node {
                id
                title
              }
            }
          }
        }
      }`,
    { variables: { id: gid } },
  );
  const responseJson: {
    data?: {
      collection?: {
        title: string;
        products: { edges: { node: { id: string; title: string } }[] };
      };
    };
    errors?: unknown;
  } = await response.json();
  if (responseJson.errors) {
    console.error("CollectionProducts GraphQL errors:", responseJson.errors);
  }
  const node = responseJson.data?.collection;
  const products: SnapshotProduct[] =
    node?.products?.edges?.map((e) => ({
      id: numericIdFromGid(e.node.id),
      title: e.node.title,
    })) ?? [];
  return { title: node?.title, products };
}

export async function syncCollectionSnapshot(params: {
  shop: string;
  collectionId: string;
  collectionTitle: string | null;
  source: string;
  currentProducts: SnapshotProduct[];
  actor: string | null;
  // Whether the collection is being observed for the first time because it's
  // genuinely brand new (collections/create — 0 -> N products is a real
  // addition) vs. because we simply haven't seen it before now
  // (collections/update on a pre-existing collection — its current members
  // aren't newly added, so seed a silent baseline instead of logging them).
  treatMissingSnapshotAsAdditions: boolean;
}) {
  const {
    shop,
    collectionId,
    collectionTitle,
    source,
    currentProducts,
    actor,
    treatMissingSnapshotAsAdditions,
  } = params;

  const snapshot = await db.collectionSnapshot.findUnique({
    where: { shop_collectionId: { shop, collectionId } },
  });

  const logEntries: {
    productId: string;
    productTitle: string | null;
    action: "added_to_collection" | "removed_from_collection";
  }[] = [];

  if (snapshot) {
    const previousProducts: SnapshotProduct[] = JSON.parse(snapshot.productIds);
    const previousTitleById = new Map(previousProducts.map((p) => [p.id, p.title]));
    const previousIdSet = new Set(previousProducts.map((p) => p.id));
    const currentIdSet = new Set(currentProducts.map((p) => p.id));

    const added = currentProducts.filter((p) => !previousIdSet.has(p.id));
    const removed = previousProducts.filter((p) => !currentIdSet.has(p.id));

    logEntries.push(
      ...added.map((p) => ({
        productId: p.id,
        productTitle: p.title ?? null,
        action: "added_to_collection" as const,
      })),
      ...removed.map((p) => ({
        productId: p.id,
        productTitle: p.title ?? previousTitleById.get(p.id) ?? null,
        action: "removed_from_collection" as const,
      })),
    );
  } else if (treatMissingSnapshotAsAdditions) {
    logEntries.push(
      ...currentProducts.map((p) => ({
        productId: p.id,
        productTitle: p.title ?? null,
        action: "added_to_collection" as const,
      })),
    );
  }

  await db.$transaction([
    ...logEntries.map((entry) =>
      db.productLog.create({
        data: {
          shop,
          productId: entry.productId,
          productTitle: entry.productTitle,
          action: entry.action,
          collectionId,
          collectionTitle,
          source,
          actor,
        },
      }),
    ),
    db.collectionSnapshot.upsert({
      where: { shop_collectionId: { shop, collectionId } },
      create: { shop, collectionId, productIds: JSON.stringify(currentProducts) },
      update: { productIds: JSON.stringify(currentProducts) },
    }),
  ]);

  return logEntries;
}
