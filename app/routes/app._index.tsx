import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  // Preserve shop/host/embedded/session-token query params from the
  // original request — dropping them breaks App Bridge's ability to
  // initialize on the redirected page (it reads `shop` from the URL).
  const url = new URL(request.url);
  return redirect(`/app/logs${url.search}`);
};
