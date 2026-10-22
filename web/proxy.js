import { isProtectedPath, isAuthPath, isPrivatePath } from "./lib/auth-navigation";
import { NextResponse } from "next/server";

import {
  CATALOG_KINDS,
  INFO_PAGE_SLUGS,
  catalogSlugExists,
  infoPageExists,
} from "./lib/catalog-availability";

/**
 * Not-found shim for catalog detail + owner-editable info routes, and headers
 * for private/auth routes.
 *
 * Next 16.4 answers a `notFound()` thrown from a dynamic page with status 404
 * and an EMPTY document: React runs no error boundaries during server
 * rendering, so the throw escapes the Fizz shell and the recovery render seeds
 * the hard-coded `<html id="__next_error__">` document (vercel/next.js#99287,
 * #99793). The Persian 404 therefore existed only in the RSC payload and
 * appeared after hydration — no header, no footer, and nothing at all for a
 * client without JavaScript.
 *
 * An unmatched route (`/_not-found/`), by contrast, enters Next's router-server
 * 404 branch (`res.statusCode = 404`) and renders `app/not-found.js` inside the
 * full root layout (header, footer, fonts, theme, `<meta name="robots"
 * content="noindex"/>`). Rewriting via `request.nextUrl` keeps the rewrite
 * internal even when Nginx forwards a public `Host` / `X-Forwarded-Proto: https`
 * header to `http://web:3000`.
 *
 * Deliberate choices:
 *  - RSC/prefetch requests are left alone: client-side navigations to a
 *    missing slug still get the framework's not-found boundary, which works
 *    after hydration, and a rewrite would swap the route under the router.
 *  - `null` (upstream error/timeout) fails open: the page renders its retryable
 *    fallback rather than turning an API hiccup into a false 404.
 */
export const config = {
  matcher: [
    "/products/:path*",
    "/brands/:path*",
    "/about/:path*",
    "/contact/:path*",
    "/shipping-returns/:path*",
    "/terms/:path*",
    "/privacy/:path*",
    "/account/:path*",
    "/wishlist/:path*",
    "/checkout/:path*",
    "/cart/:path*",
    "/payment/:path*",
    "/login/:path*",
    "/register/:path*",
    "/password-reset/:path*",
    "/reset-password/:path*",
  ],
};

// Only the canonical trailing-slash URLs (next.config.mjs sets trailingSlash).
// The slash-less spelling is left to Next's own 308 to the canonical URL
// instead of being rendered as a 404 under a non-canonical address.
const DETAIL_PAGE = /^\/(products|brands)\/([^/]+)\/$/;
const INFO_PAGE = /^\/(about|contact|shipping-returns|terms|privacy)\/$/;

function rewriteNotFound(request, fallbackUrl) {
  if (!request.nextUrl) {
    return NextResponse.rewrite(new URL("/_not-found/", fallbackUrl), { status: 404 });
  }
  const runtimeEnv = globalThis.process?.env || {};
  const forwardedProto = request.headers.get("x-forwarded-proto") || "";
  const protocol = forwardedProto.includes("https")
    ? "https:"
    : request.nextUrl.protocol || "http:";
  const hostname = runtimeEnv.HOSTNAME || request.nextUrl.hostname || "localhost";
  const host =
    hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  const port = runtimeEnv.PORT || request.nextUrl.port;
  const origin = port ? `${protocol}//${host}:${port}` : `${protocol}//${host}`;
  return NextResponse.rewrite(new URL("/_not-found/", origin), { status: 404 });
}

export async function proxy(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();
  const url = new URL(request.url);
  if (isProtectedPath(url.pathname) || isAuthPath(url.pathname) || isPrivatePath(url.pathname)) {
    // Overwrite, never trust a browser-supplied path header. The RSC gate uses
    // this exact query string rather than rebuilding/reordering searchParams.
    const forwarded = new Headers(request.headers);
    forwarded.set("x-auth-original-url", url.pathname + url.search);
    const response = NextResponse.next({ request: { headers: forwarded } });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("X-Robots-Tag", "noindex, follow");
    return response;
  }

  const infoMatch = INFO_PAGE.exec(url.pathname);
  if (infoMatch) {
    const [, infoSlug] = infoMatch;
    if (!INFO_PAGE_SLUGS.has(infoSlug)) return NextResponse.next();
    if (request.headers.has("rsc") || request.headers.has("next-router-prefetch")) {
      return NextResponse.next();
    }
    const published = await infoPageExists(infoSlug, {
      host: request.headers.get("host") || "localhost",
      proto: request.headers.get("x-forwarded-proto") || "http",
      forwardedFor: request.headers.get("x-forwarded-for") || undefined,
    });
    if (published !== false) return NextResponse.next();
    return rewriteNotFound(request, url);
  }

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
  return rewriteNotFound(request, url);
}
