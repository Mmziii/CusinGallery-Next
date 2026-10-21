import { headers } from "next/headers";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import { normalizeContent } from "../content/defaults";
import { djangoRequest } from "./django-request";

const PUBLIC_REVALIDATE_SECONDS = 60;

// Public calls never forward cookies. Opt-in private calls are never cached.
// `noCache` is the other uncached mode: a PUBLIC (cookie-free) call that must
// be re-read on every render. Owner-edited content -- banners, and above all
// the daily deals, whose prices and countdown depend on `server_now` -- cannot
// live behind the 60s window: the live shop showed one deal while the API
// already had four, and the countdown started from a stale server clock.
export async function apiServer(path, { privateData = false, noCache = false } = {}) {
  if (typeof path !== "string" || !path.startsWith("/api/v1/") || path.startsWith("//")) {
    throw new Error("Expected a relative Django API path");
  }
  const incoming = await headers();
  const host = incoming.get("host") || "localhost";
  const proto = incoming.get("x-forwarded-proto") || "http";
  const forwardedFor = incoming.get("x-forwarded-for") || undefined;
  if (privateData) {
    return djangoRequest(path, { host, proto, forwardedFor, cookie: incoming.get("cookie") || undefined });
  }
  if (noCache) {
    return djangoRequest(path, { host, proto, forwardedFor });
  }
  // Public data is cached for 60s keyed by (path + public host) only: Django
  // builds absolute URLs from the forwarded host, so different public hosts
  // must never share an entry, while per-visitor data (cookie, X-Forwarded-For)
  // must not fragment the cache. The cookie is never sent on public calls.
  // headers() is read above, outside the cached callback, as unstable_cache
  // callbacks must not read request data.
  const load = unstable_cache(
    async () => djangoRequest(path, { host, proto, forwardedFor }),
    ["api-server", path, host],
    { revalidate: PUBLIC_REVALIDATE_SECONDS }
  );
  return load();
}

export async function allPages(path, options = {}) {
  const first = await apiServer(path, options);
  if (Array.isArray(first)) return { results: first };
  const results = [...(first.results || [])];
  let next = first.next;
  const seen = new Set([path]);
  while (next) {
    const url = new URL(next, "http://django");
    const relative = url.pathname + url.search;
    if (seen.has(relative)) throw new Error("Pagination loop");
    seen.add(relative);
    const page = await apiServer(relative, options);
    results.push(...(page.results || []));
    next = page.next;
  }
  return { ...first, results, next: null };
}

export const getSite = cache(async () => {
  const [settings, content] = await Promise.all([
    apiServer("/api/v1/site/settings/").catch(() => ({})),
    apiServer("/api/v1/site/content/").catch(() => null),
  ]);
  return { settings, content: normalizeContent(content) };
});

export async function getHomeData() {
  // Banners and daily deals are owner-edited, minute-to-minute content: they
  // are read fresh on every render (still cookie-free). Everything else keeps
  // the 60s public cache.
  const [banners, categories, deals, brands, featured, fresh, best_sellers, reviewProducts] = await Promise.all([
    allPages("/api/v1/banners/", { noCache: true }).catch(() => ({ results: [] })),
    allPages("/api/v1/categories/tree/").catch(() => ({ results: [] })),
    allPages("/api/v1/banners/daily-deals/", { noCache: true }).catch(() => ({ results: [] })),
    allPages("/api/v1/brands/?is_featured=true").catch(() => ({ results: [] })),
    apiServer("/api/v1/products/?is_featured=true").catch(() => ({ results: [], failed: true })),
    apiServer("/api/v1/products/?is_new=true").catch(() => ({ results: [], failed: true })),
    apiServer("/api/v1/products/?is_best_seller=true").catch(() => ({ results: [], failed: true })),
    apiServer("/api/v1/products/?is_best_seller=true&page_size=4").catch(() => ({ results: [], failed: true })),
  ]);
  const reviews = (
    await Promise.all(
      (reviewProducts.results || []).slice(0, 3).map(async (product) => {
        try {
          const data = await apiServer(`/api/v1/reviews/product/${product.id}/?page_size=1`);
          return { product, review: data.results?.[0] };
        } catch {
          return { product };
        }
      })
    )
  ).filter((entry) => entry.review);
  return { banners: banners.results, categories: categories.results, deals, brands, featured, new: fresh, best_sellers, reviewProducts, reviews };
}
