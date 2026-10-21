import { apiServer, allPages } from "./api-server";

/**
 * Server-side catalog reads for the SSR shop / product / brand pages.
 *
 * Everything goes through api-server's node:http client (never fetch: undici
 * drops the Host header and Django answers DisallowedHost). The query strings
 * are built with the SAME keys and spellings the SPA sent, so existing links,
 * bookmarks and the backend's filter contract (apps/products/filters.py) keep
 * working unchanged.
 */

//: The listing's own contract -- exactly ShopPage.jsx's whitelist. Attribute
//: facets are added separately (attr_<slug>).
export const SHOP_FILTER_KEYS = [
  "search",
  "category",
  "brand",
  "min_price",
  "max_price",
  "in_stock",
  "on_sale",
  "ordering",
  "page",
];

/**
 * Hard ceiling for the "first N pages" pager. `?page=N` concatenates pages
 * 1..N, so it used to fan out into N parallel Django calls -- an unbounded
 * (and crawler-reachable) amplification. Five pages (100 products at the
 * backend's 20/page) is the deepest link that is still served in one render;
 * anything deeper is redirected down to it.
 */
export const MAX_SHOP_PAGES = 5;

const single = (value) => (Array.isArray(value) ? value[value.length - 1] : value);

/**
 * Next hands searchParams as { key: string | string[] | undefined }; the shop
 * needs the plain object the SPA built from URLSearchParams. Keeps the
 * insertion order of the incoming query, like URLSearchParams did.
 */
export function parseShopParams(searchParams = {}, { brandSlug = null } = {}) {
  const params = {};
  for (const key of SHOP_FILTER_KEYS) {
    const value = single(searchParams[key]);
    if (value) params[key] = String(value);
  }
  for (const [key, raw] of Object.entries(searchParams)) {
    const value = single(raw);
    if (key.startsWith("attr_") && value) params[key] = String(value);
  }
  // A brand URL is a fixed scope, not an optional query-string filter.
  if (brandSlug) params.brand = brandSlug;
  return params;
}

export function shopQueryString(params = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  return query.toString();
}

const withQuery = (path, params) => {
  const query = shopQueryString(params);
  return query ? `${path}?${query}` : path;
};

/**
 * Validates `?page=N` BEFORE any Django call.
 *
 * Returns `{ page, redirect }`:
 *   - `redirect: null`         -> serve this request as-is (`page` is 1..MAX)
 *   - `redirect: MAX_SHOP_PAGES` -> 308 the same URL down to the last page
 *   - `redirect: "drop"`       -> 308 the same URL without `?page=`
 *
 * Only a plain positive integer is a page. "0", "-2", "3.5", "abc" and empty
 * values are invalid (not "page 1"), so they are redirected to the canonical
 * page-less URL instead of being silently rendered -- crawlers then never keep
 * an endless supply of junk `?page=` URLs alive.
 */
export function readShopPage(raw) {
  if (raw === undefined || raw === null || raw === "") return { page: 1, redirect: null };
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return { page: 1, redirect: "drop" };
  const page = Number(text);
  if (!Number.isSafeInteger(page) || page < 1) return { page: 1, redirect: "drop" };
  if (page > MAX_SHOP_PAGES) return { page: MAX_SHOP_PAGES, redirect: MAX_SHOP_PAGES };
  return { page, redirect: null };
}

/**
 * Same-listing URL for a given page, page 1 without any `?page=` parameter.
 * Used for the redirects above, so the query format stays the SPA's (and a
 * brand page's fixed scope stays on the path instead of becoming ?brand=).
 */
export function shopPageHref(basePath, params = {}, { page = null, fixedBrand = null } = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page") continue;
    if (fixedBrand && key === "brand") continue;
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  if (page && page > 1) query.set("page", String(page));
  const next = query.toString();
  return next ? `${basePath}?${next}` : basePath;
}

export const listProducts = (params = {}) => apiServer(withQuery("/api/v1/products/", params));
export const listFacets = (params = {}) => allPages(withQuery("/api/v1/products/facets/", params));
export const listCategories = () => allPages("/api/v1/categories/");
export const listBrands = () => allPages("/api/v1/brands/");
export const getBrand = (slug) => apiServer(`/api/v1/brands/${encodeURIComponent(slug)}/`);
export const getProduct = (slug) => apiServer(`/api/v1/products/${encodeURIComponent(slug)}/`);

/** True for a Django 404 (unknown/inactive slug, unknown category...). */
export function isNotFound(error) {
  return error?.status === 404 || /: 404$/.test(String(error?.message || ""));
}

/**
 * The listing itself. `?page=N` means "the first N pages" (SEO + back button):
 * page 1 keeps the single request it always had, deeper links concatenate the
 * pages 1..N exactly like the SPA's «نمایش کالاهای بیشتر». N is capped by
 * MAX_SHOP_PAGES before this is called, and the walk is SEQUENTIAL: it stops at
 * the first page Django marks as the last (`next === null`) or answers 404,
 * so no request is ever fired past the real end of the listing.
 */
export async function getShopProducts(params = {}) {
  const requested = Math.trunc(Number(params.page) || 1);
  const pageCount = Math.min(Math.max(1, requested), MAX_SHOP_PAGES);
  if (pageCount <= 1) return listProducts(params);

  const pages = [];
  for (let page = 1; page <= pageCount; page += 1) {
    let data;
    try {
      data = await listProducts({ ...params, page });
    } catch (error) {
      // Page 1 failing is a real outage (retry state); a later page failing
      // means we walked past the end -- keep what exists and render it.
      if (page === 1) throw error;
      break;
    }
    pages.push(data);
    if (!data || !data.next) break;
  }
  const last = pages[pages.length - 1] || {};
  return { ...last, results: pages.flatMap((page) => page.results || []), next: null };
}

/** Facets re-scope to the selected category/brand, like the SPA. */
export function getShopFacets(params = {}) {
  const scope = {};
  if (params.category) scope.category = params.category;
  if (params.brand) scope.brand = params.brand;
  return listFacets(scope);
}

/** Everything the shop page renders, resolved in parallel. */
export async function getShopData(params = {}, { fixedBrand = null } = {}) {
  const [products, categories, brands, facets] = await Promise.all([
    getShopProducts(params).catch((error) => ({ error, results: [], count: 0 })),
    listCategories().catch(() => ({ results: [] })),
    listBrands().catch(() => ({ results: [] })),
    getShopFacets(params).catch(() => ({ results: [] })),
  ]);
  return {
    params,
    fixedBrand,
    products,
    categories: categories.results || [],
    brands: brands.results || [],
    facets: facets.results || [],
  };
}

/** Reviews summary + first page, server-rendered (the form stays client-side). */
export async function getProductReviews(productId) {
  if (!productId) return { summary: null, reviews: null };
  const [summary, reviews] = await Promise.all([
    apiServer(`/api/v1/reviews/product/${productId}/summary/`).catch(() => null),
    apiServer(`/api/v1/reviews/product/${productId}/`).catch(() => null),
  ]);
  return { summary, reviews };
}
