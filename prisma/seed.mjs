import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Must match the shop domain of the store you install the app on
// (e.g. your-dev-store.myshopify.com), otherwise /app/logs will show
// nothing since it filters by the authenticated session's shop.
const shop = process.env.SEED_SHOP || "quickstart-abc123.myshopify.com";

const minutesAgo = (n) => new Date(Date.now() - n * 60_000);

async function main() {
  await prisma.productLog.deleteMany({ where: { shop } });

  await prisma.productLog.createMany({
    data: [
      {
        shop,
        productId: "1001",
        productTitle: "Classic Snowboard",
        action: "created",
        source: "products/create",
        actor: "App: Product Log",
        createdAt: minutesAgo(120),
      },
      {
        shop,
        productId: "1001",
        productTitle: "Classic Snowboard",
        action: "updated",
        field: "status",
        oldValue: "draft",
        newValue: "active",
        source: "products/update",
        actor: "Jane Doe",
        createdAt: minutesAgo(110),
      },
      {
        shop,
        productId: "1001",
        productTitle: "Classic Snowboard",
        action: "updated",
        field: "variant[Default].price",
        oldValue: "199.99",
        newValue: "179.99",
        source: "products/update",
        actor: "Jane Doe",
        createdAt: minutesAgo(60),
      },
      {
        shop,
        productId: "1001",
        productTitle: "Classic Snowboard",
        action: "added_to_collection",
        collectionId: "501",
        collectionTitle: "Winter Sale",
        source: "collections/update",
        actor: "Jane Doe",
        createdAt: minutesAgo(45),
      },
      {
        shop,
        productId: "1002",
        productTitle: "Alpine Ski Poles",
        action: "created",
        source: "products/create",
        actor: "App: Product Log",
        createdAt: minutesAgo(30),
      },
      {
        shop,
        productId: "1002",
        productTitle: "Alpine Ski Poles",
        action: "updated",
        field: "tags",
        oldValue: "ski",
        newValue: "ski, poles, winter",
        source: "products/update",
        actor: null,
        createdAt: minutesAgo(20),
      },
      {
        shop,
        productId: "999",
        productTitle: "Discontinued Beanie",
        action: "removed_from_collection",
        collectionId: "501",
        collectionTitle: "Winter Sale",
        source: "collections/update",
        actor: "John Smith",
        createdAt: minutesAgo(15),
      },
      {
        shop,
        productId: "999",
        productTitle: "Discontinued Beanie",
        action: "deleted",
        source: "products/delete",
        actor: null,
        createdAt: minutesAgo(5),
      },
    ],
  });

  const count = await prisma.productLog.count({ where: { shop } });
  console.log(`Seeded ${count} ProductLog rows for shop "${shop}"`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
