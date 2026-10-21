/**
 * Listing pagination rules, shared by the server components and the shop's
 * client island. Deliberately dependency-free (no imports): the server reads
 * Django through `lib/catalog-server.js`, the phone's «نمایش کالاهای بیشتر»
 * calls the public API from the browser, and both must agree on what
 * `?page=N` means, which values are legal, and how a page URL is spelled.
 *
 * Standard pagination: `?page=N` is page N, and only page N.
 */

/** DRF's PAGE_SIZE for the product listing (backend/config/settings/base.py). */
export const SHOP_PAGE_SIZE = 20;

/**
 * Reads `?page=` exactly the way the storefront writes it: a plain positive
 * integer. Missing/empty means page 1; anything else ("abc", "0", "-2",
 * "3.5", "007") is invalid and gets normalised away by the caller (308 to the
 * same URL without the parameter) instead of being guessed at.
 */
export function readShopPage(raw) {
  if (raw === undefined || raw === null || raw === "") return { page: 1, invalid: false };
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return { page: 1, invalid: true };
  const page = Number(text);
  if (!Number.isSafeInteger(page) || page < 1) return { page: 1, invalid: true };
  // "007" is a duplicate of "7": normalise the spelling, keep the meaning.
  if (String(page) !== text) return { page, invalid: true };
  return { page, invalid: false };
}

/**
 * The same listing URL for a given page. Page 1 (or `page: null`) carries NO
 * `?page=` parameter at all, so the canonical URL is the only spelling a
 * crawler ever sees; a brand page keeps its fixed scope on the path instead of
 * becoming `?brand=`.
 */
export function shopHref(basePath, params = {}, { page = null, fixedBrand = null } = {}) {
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

/** Number of pages a listing of `count` products has (0 when empty). */
export function totalPages(count) {
  const total = Number(count);
  if (!Number.isFinite(total) || total <= 0) return 0;
  return Math.ceil(total / SHOP_PAGE_SIZE);
}

/**
 * The numbered links the SPA rendered: first, last, and the ±2 neighbours of
 * the current page. Unchanged so the desktop pager looks the same.
 */
export function pageWindow(currentPage, pages) {
  return Array.from({ length: pages }, (_, index) => index + 1).filter(
    (page) => page === 1 || page === pages || Math.abs(page - currentPage) <= 2
  );
}
