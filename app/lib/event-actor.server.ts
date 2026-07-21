import { authenticate } from "../shopify.server";

type AdminClient = NonNullable<
  Awaited<ReturnType<typeof authenticate.webhook>>["admin"]
>;

// Shopify webhooks don't say who made the change. The closest we can get is
// the resource's own event timeline (Admin GraphQL), which is either
// attributed to an app (reliable — appTitle) or to an admin user (only a
// human-readable `message` that usually embeds the staff member's name,
// e.g. "Jane Doe changed the price..." — there's no structured name/id
// field, so this is best-effort).
const NAME_PREFIX = /^([A-Z][\p{L}.'-]+(?: [A-Z][\p{L}.'-]+){0,3})\b/u;

function actorFromEvent(event: {
  message: string;
  attributeToApp: boolean;
  attributeToUser: boolean;
  appTitle: string | null;
} | null): string | null {
  if (!event) return null;
  if (event.attributeToApp) {
    return event.appTitle ? `App: ${event.appTitle}` : "App";
  }
  if (event.attributeToUser) {
    const match = event.message.match(NAME_PREFIX);
    return match ? match[1] : event.message;
  }
  return null;
}

async function fetchLatestEvent(
  admin: AdminClient,
  resourceField: "product" | "collection",
  gid: string,
) {
  const response = await admin.graphql(
    `#graphql
      query LatestEvent($id: ID!) {
        ${resourceField}(id: $id) {
          events(first: 1, sortKey: CREATED_AT, reverse: true) {
            nodes {
              message
              attributeToApp
              attributeToUser
              appTitle
            }
          }
        }
      }`,
    { variables: { id: gid } },
  );
  const responseJson: {
    data?: {
      [key: string]: {
        events?: {
          nodes: {
            message: string;
            attributeToApp: boolean;
            attributeToUser: boolean;
            appTitle: string | null;
          }[];
        };
      } | null;
    };
    errors?: unknown;
  } = await response.json();
  if (responseJson.errors) {
    console.error("LatestEvent GraphQL errors:", responseJson.errors);
    return null;
  }
  return responseJson.data?.[resourceField]?.events?.nodes?.[0] ?? null;
}

export async function fetchLatestActor(
  admin: AdminClient,
  resourceField: "product" | "collection",
  gid: string,
): Promise<string | null> {
  try {
    const event = await fetchLatestEvent(admin, resourceField, gid);
    return actorFromEvent(event);
  } catch (error) {
    console.error(`Failed to fetch latest event for ${gid}:`, error);
    return null;
  }
}
