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

/** True for a Django 404 (unknown/inactive slug, unknown category...). */
export function isNotFound(error) {
  return error?.status === 404 || /: 404$/.test(String(error?.message || ""));
}

/**
 * The listing itself. `?page=N` means "the first N pages" (SEO + back button):
 * page 1 keeps the single request it always had, deeper links concatenate the
 * pages 1..N exactly like the SPA's «نمایش کالاهای بیشتر».
 */
export async function getShopProducts(params = {}) {
  const currentPage = Math.max(1, Number(params.page) || 1);
  if (currentPage <= 1) return listProducts(params);
  const pages = await Promise.all(
    Array.from({ length: currentPage }, (_, index) => listProducts({ ...params, page: index + 1 }))
  );
  const last = pages[pages.length - 1];
  return { ...last, results: pages.flatMap((page) => page.results || []) };
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
