import { apiServer, allPages } from "./api-server";
import { readShopPage, SHOP_PAGE_SIZE, shopHref } from "../utils/shopPaging";

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

export const listProducts = (params = {}) => apiServer(withQuery("/api/v1/products/", params));
export const listFacets = (params = {}) => allPages(withQuery("/api/v1/products/facets/", params));
export const listCategories = () => allPages("/api/v1/categories/");
export const listBrands = () => allPages("/api/v1/brands/");
export const getBrand = (slug) => apiServer(`/api/v1/brands/${encodeURIComponent(slug)}/`);
export const getProduct = (slug) => apiServer(`/api/v1/products/${encodeURIComponent(slug)}/`);

export { readShopPage, shopHref, SHOP_PAGE_SIZE };

/** True for a Django 404 (unknown/inactive slug, unknown category...). */
export function isNotFound(error) {
  return error?.status === 404 || /: 404$/.test(String(error?.message || ""));
}

/**
 * The listing itself: exactly ONE Django request, for the requested page and
 * nothing else. Standard pagination replaced the old "first N pages" model
 * (which fetched pages 1..N and concatenated them): page 3 shows products
 * 41-60, page 8 shows 141-160, and the desktop pager can walk all 8 pages.
 *
 * A page past the end is a DRF 404 ("Invalid page"). Rather than showing an
 * empty grid -- or, worse, walking pages until one works -- we read `count`
 * with ONE extra request (page 1) and hand the caller a 308 target: the real
 * last page. The target is always < the requested page (or the page-less URL),
 * so a redirect can never loop.
 */
export async function getShopProducts(params = {}, { basePath = "/shop/", fixedBrand = null } = {}) {
  const { page } = readShopPage(params.page);
  // Only the integer spelling reaches Django; "?page=" never does for page 1.
  const request = page > 1 ? { ...params, page: String(page) } : withoutPage(params);
  try {
    return await listProducts(request);
  } catch (error) {
    if (page <= 1 || !isNotFound(error)) throw error;
    const lastPage = await lastShopPage(params);
    return {
      count: 0,
      next: null,
      previous: null,
      results: [],
      redirectTo: shopHref(basePath, params, { page: lastPage, fixedBrand }),
    };
  }
}

/** Removes `page` entirely, so page 1 keeps its single plain request. */
function withoutPage(params = {}) {
  if (params.page === undefined) return params;
  const { page, ...rest } = params;
  return rest;
}

/** The real last page of the listing, from ONE page-1 request. */
async function lastShopPage(params = {}) {
  try {
    const first = await listProducts(withoutPage(params));
    const total = Math.ceil(Number(first?.count) / SHOP_PAGE_SIZE);
    return Number.isFinite(total) && total > 1 ? total : null;
  } catch {
    // The listing itself is down: land on the canonical first page, whose
    // render will show the normal retry state instead of a redirect loop.
    return null;
  }
}

/** Facets re-scope to the selected category/brand, like the SPA. */
export function getShopFacets(params = {}) {
  const scope = {};
  if (params.category) scope.category = params.category;
  if (params.brand) scope.brand = params.brand;
  return listFacets(scope);
}

/** Everything the shop page renders, resolved in parallel. */
export async function getShopData(params = {}, { fixedBrand = null, basePath } = {}) {
  const listingPath = basePath || (fixedBrand ? `/brands/${encodeURIComponent(fixedBrand.slug)}/` : "/shop/");
  const [products, categories, brands, facets] = await Promise.all([
    getShopProducts(params, { basePath: listingPath, fixedBrand }).catch((error) => ({
      error,
      results: [],
      count: 0,
    })),
    listCategories().catch(() => ({ results: [] })),
    listBrands().catch(() => ({ results: [] })),
    getShopFacets(params).catch(() => ({ results: [] })),
  ]);
  return {
    params,
    fixedBrand,
    // Set when the requested page is past the end: the caller 308s to it.
    redirectTo: products.redirectTo || null,
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
