import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { fetchLatestActor } from "../lib/event-actor.server";

type VariantPayload = {
  id: number | string;
  title?: string;
  sku?: string | null;
  price?: string;
  compare_at_price?: string | null;
  inventory_quantity?: number;
};

type ProductPayload = {
  id: number | string;
  title?: string;
  vendor?: string;
  product_type?: string;
  handle?: string;
  status?: string;
  tags?: string;
  variants?: VariantPayload[];
  admin_graphql_api_id?: string;
  image?: { src?: string } | null;
};

const SCALAR_FIELDS = [
  "title",
  "vendor",
  "product_type",
  "handle",
  "status",
  "tags",
] as const;

const VARIANT_FIELDS = [
  "price",
  "compare_at_price",
  "sku",
  "inventory_quantity",
] as const;

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload, admin } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  const product = payload as unknown as ProductPayload;
  const productId = String(product.id);
  const productTitle = product.title ?? null;
  const productImage = product.image?.src ?? null;
  const gid =
    product.admin_graphql_api_id ?? `gid://shopify/Product/${productId}`;

  const previousSnapshot = await db.productSnapshot.findUnique({
    where: { shop_productId: { shop, productId } },
  });
  const previous: ProductPayload | null = previousSnapshot
    ? JSON.parse(previousSnapshot.data)
    : null;

  const logEntries: {
    action: "updated" | "variant_added" | "variant_removed";
    field: string;
    oldValue: string | null;
    newValue: string | null;
  }[] = [];

  if (previous) {
    for (const field of SCALAR_FIELDS) {
      const oldValue = previous[field] ?? null;
      const newValue = product[field] ?? null;
      if (String(oldValue ?? "") !== String(newValue ?? "")) {
        logEntries.push({
          action: "updated",
          field,
          oldValue: oldValue == null ? null : String(oldValue),
          newValue: newValue == null ? null : String(newValue),
        });
      }
    }

    const previousVariants = new Map(
      (previous.variants ?? []).map((v) => [String(v.id), v]),
    );
    const currentVariants = new Map(
      (product.variants ?? []).map((v) => [String(v.id), v]),
    );

    for (const variant of product.variants ?? []) {
      const variantId = String(variant.id);
      const prevVariant = previousVariants.get(variantId);

      if (!prevVariant) {
        logEntries.push({
          action: "variant_added",
          field: `variant[${variant.title ?? variantId}]`,
          oldValue: null,
          newValue: variant.price ?? null,
        });
        continue;
      }

      for (const field of VARIANT_FIELDS) {
        const oldValue = prevVariant[field] ?? null;
        const newValue = variant[field] ?? null;
        if (String(oldValue ?? "") !== String(newValue ?? "")) {
          logEntries.push({
            action: "updated",
            field: `variant[${variant.title ?? variantId}].${field}`,
            oldValue: oldValue == null ? null : String(oldValue),
            newValue: newValue == null ? null : String(newValue),
          });
        }
      }
    }

    for (const variant of previous.variants ?? []) {
      const variantId = String(variant.id);
      if (!currentVariants.has(variantId)) {
        logEntries.push({
          action: "variant_removed",
          field: `variant[${variant.title ?? variantId}]`,
          oldValue: variant.price ?? null,
          newValue: null,
        });
      }
    }
  }

  if (logEntries.length === 0) {
    await db.productSnapshot.upsert({
      where: { shop_productId: { shop, productId } },
      create: { shop, productId, data: JSON.stringify(product) },
      update: { data: JSON.stringify(product) },
    });
    return new Response();
  }

  const actor = admin ? await fetchLatestActor(admin, "product", gid) : null;

  await db.$transaction([
    ...logEntries.map((entry) =>
      db.productLog.create({
        data: {
          shop,
          productId,
          productTitle,
          productImage,
          action: entry.action,
          field: entry.field,
          oldValue: entry.oldValue,
          newValue: entry.newValue,
          source: topic,
          actor,
        },
      }),
    ),
    db.productSnapshot.upsert({
      where: { shop_productId: { shop, productId } },
      create: { shop, productId, data: JSON.stringify(product) },
      update: { data: JSON.stringify(product) },
    }),
  ]);

  return new Response();
};
