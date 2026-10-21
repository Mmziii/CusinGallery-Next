import { headers } from "next/headers";
import { cache } from "react";
import { normalizeContent } from "../content/defaults";

// Public calls never forward cookies. Opt-in private calls are always no-store.
export async function apiServer(path, { privateData = false } = {}) {
  const incoming = await headers();
  if (!path.startsWith("/api/v1/") || path.startsWith("//")) throw new Error("Expected a relative Django API path");
  const url = new URL(path, process.env.INTERNAL_API_URL || "http://backend:8000");
  const requestHeaders = { Host: incoming.get("host") || "localhost", "X-Forwarded-Proto": incoming.get("x-forwarded-proto") || "http" };
  if (privateData) requestHeaders.Cookie = incoming.get("cookie") || "";
  const response = await fetch(url, { headers: requestHeaders, ...(privateData ? { cache: "no-store" } : { next: { revalidate: 60 } }), signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`Django ${path}: ${response.status}`);
  return response.json();
}
export async function allPages(path) {
  const first = await apiServer(path);
  if (Array.isArray(first)) return { results: first };
  const results = [...(first.results || [])];
  let next = first.next;
  const seen = new Set([path]);
  while (next) {
    const url = new URL(next, "http://django");
    const relative = url.pathname + url.search;
    if (seen.has(relative)) throw new Error("Pagination loop");
    seen.add(relative);
    const page = await apiServer(relative);
    results.push(...(page.results || [])); next = page.next;
  }
  return { ...first, results, next: null };
}
export const getSite = cache(async () => {
  const [settings, content] = await Promise.all([apiServer("/api/v1/site/settings/").catch(() => ({})), apiServer("/api/v1/site/content/").catch(() => null)]);
  return { settings, content: normalizeContent(content) };
});
export async function getHomeData() {
  const [banners, categories, deals, brands, featured, fresh, best_sellers, reviewProducts] = await Promise.all([
    allPages("/api/v1/banners/").catch(() => ({ results: [] })), allPages("/api/v1/categories/tree/").catch(() => ({ results: [] })), allPages("/api/v1/banners/daily-deals/").catch(() => ({ results: [] })), allPages("/api/v1/brands/?is_featured=true").catch(() => ({ results: [] })),
    apiServer("/api/v1/products/?is_featured=true").catch(() => ({ results: [], failed: true })), apiServer("/api/v1/products/?is_new=true").catch(() => ({ results: [], failed: true })), apiServer("/api/v1/products/?is_best_seller=true").catch(() => ({ results: [], failed: true })), apiServer("/api/v1/products/?is_best_seller=true&page_size=4").catch(() => ({ results: [], failed: true }))
  ]);
  const reviews = (await Promise.all((reviewProducts.results || []).slice(0, 3).map(async product => {
    try { const data = await apiServer(`/api/v1/reviews/product/${product.id}/?page_size=1`); return { product, review: data.results?.[0] }; }
    catch { return { product }; }
  }))).filter(entry => entry.review);
  return { banners: banners.results, categories: categories.results, deals, brands, featured, new: fresh, best_sellers, reviewProducts, reviews };
}
