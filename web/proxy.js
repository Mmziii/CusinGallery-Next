import { NextResponse } from "next/server";

import { CATALOG_KINDS, catalogSlugExists } from "./lib/catalog-availability";

/**
 * Not-found shim for the catalog detail routes.
 *
 * Next 16.4 answers a `notFound()` thrown from a dynamic page with status 404
 * and an EMPTY document: React runs no error boundaries during server
 * rendering, so the throw escapes the Fizz shell and the recovery render seeds
 * the hard-coded `<html id="__next_error__">` document (vercel/next.js#99287,
 * #99793). The Persian 404 therefore existed only in the RSC payload and
 * appeared after hydration — no header, no footer, and nothing at all for a
 * client without JavaScript.
 *
 * The workaround keeps the real 404 status and re-renders the 404 page as a
 * normal page, inside the ordinary root layout (header, footer, fonts, theme):
 * the proxy asks Django whether the slug exists and, when it does not, rewrites
 * to `/not-found-page/` with `status: 404`. An unmatched URL (any route that
 * does not exist) already renders `app/not-found.js` in full, so only the
 * "route matched, entity missing" case needs this.
 *
 * Deliberate choices:
 *  - RSC/prefetch requests are left alone: client-side navigations to a
 *    missing slug still get the framework's not-found boundary, which works
 *    after hydration, and a rewrite would swap the route under the router.
 *  - `null` (upstream error/timeout) fails open: the page renders exactly as
 *    before rather than turning an API hiccup into a 404 for a real product.
 */
export const config = { matcher: ["/products/:path*", "/brands/:path*"] };

// Only the canonical detail page: /products/<slug>/ and /brands/<slug>/ with
// the trailing slash (next.config.mjs sets trailingSlash). The slash-less
// spelling is left to Next's own 308 to the canonical URL instead of being
// rendered as a 404 under a non-canonical address.
const DETAIL_PAGE = /^\/(products|brands)\/([^/]+)\/$/;

export async function proxy(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();
  const url = new URL(request.url);
  const match = DETAIL_PAGE.exec(url.pathname);
  if (!match) return NextResponse.next();
  const [, kind, rawSlug] = match;
  if (!CATALOG_KINDS.has(kind)) return NextResponse.next();

  // RSC requests keep the real route; the not-found boundary renders on the
  // client there, and a rewrite would change the route mid-navigation.
  if (request.headers.has("rsc") || request.headers.has("next-router-prefetch")) return NextResponse.next();

  let slug;
  try {
    slug = decodeURIComponent(rawSlug);
  } catch {
    return NextResponse.next();
  }

  const exists = await catalogSlugExists(kind, slug, {
    host: request.headers.get("host") || "localhost",
    proto: request.headers.get("x-forwarded-proto") || "http",
    forwardedFor: request.headers.get("x-forwarded-for") || undefined,
  });

  if (exists !== false) return NextResponse.next();
  return NextResponse.rewrite(new URL("/not-found-page/", url), { status: 404 });
}
