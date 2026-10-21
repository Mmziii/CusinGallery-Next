import http from "node:http";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

// Same testing strategy as phase 1: the Django stand-in is a REAL node:http
// server (the api-server client speaks HTTP, not fetch, so fetch mocks would
// test nothing), and only Next's request/cache/link/router primitives are
// doubled. The next/cache double is a faithful key+args in-memory cache that
// never caches rejections, so "deals are always fresh, products are cached"
// is asserted against the requests that actually reached the upstream.
const { headersMock, cacheStore, cacheOptions } = vi.hoisted(() => ({
  headersMock: vi.fn(),
  cacheStore: new Map(),
  cacheOptions: [],
}));
vi.mock("next/headers", () => ({ headers: headersMock }));
vi.mock("next/cache", () => ({
  unstable_cache: (cb, keyParts = [], options = {}) => {
    cacheOptions.push(options);
    return async (...args) => {
      const key = JSON.stringify([keyParts, args]);
      if (cacheStore.has(key)) return JSON.parse(cacheStore.get(key));
      const value = await cb(...args); // rejections propagate uncached
      cacheStore.set(key, JSON.stringify(value));
      return value;
    };
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    const error = new Error("NEXT_NOT_FOUND");
    error.digest = "NEXT_HTTP_ERROR_FALLBACK;404";
    throw error;
  },
  usePathname: () => "/shop/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  redirect: (url) => {
    throw new Error(`redirect:${url}`);
  },
  // Next's permanentRedirect throws the same digest the router acts on; the
  // status code travels in it, so tests can assert a REAL 308.
  permanentRedirect: (url) => {
    const error = new Error(`NEXT_REDIRECT:${url}`);
    error.digest = `NEXT_REDIRECT;replace;${url};308;`;
    error.redirectUrl = url;
    error.statusCode = 308;
    throw error;
  },
}));
vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

import ShopPage, { generateMetadata as shopMetadataFor } from "../app/shop/page";
import ProductPage from "../app/products/[slug]/page";
import BrandPage from "../app/brands/[slug]/page";
import NotFound from "../app/not-found";
import { getHomeData, apiServer } from "../lib/api-server";
import { formatPrice } from "../utils/formatPrice";

const TOOMAN_PRICE = 125000;
const product = {
  id: 1,
  name: "قابلمه مسی",
  slug: "copper-pot",
  sku: "CP-100",
  stock_status: "in_stock",
  is_in_stock: true,
  short_description: "قابلمه مسی دست‌ساز",
  description: "توضیحات کامل قابلمه مسی",
  price_info: { price: TOOMAN_PRICE, compare_at_price: 150000, discount_percentage: 16, is_on_sale: true },
  primary_image: { image: "/media/copper.jpg", webp_800: "/media/copper-800.webp" },
  images: [{ id: 1, image: "/media/copper.jpg" }],
  variants: [],
  specifications: [{ attribute: "جنس", values: ["مس"] }],
  category: { id: 2, name: "قابلمه", slug: "pots", parent_slug: "kitchen" },
  brand: { id: 1, name: "مس‌کاران", slug: "mes-karan" },
  related_products: [],
};

const secondProduct = {
  ...product,
  id: 2,
  name: "آبکش بلور",
  slug: "crystal-strainer",
  sku: "CS-200",
  price_info: { price: 90000, compare_at_price: null, discount_percentage: 0, is_on_sale: false },
  primary_image: null,
  images: [],
};

// The live shop has 160 products: 8 pages of 20. Page N really is items
// (N-1)*20+1 .. N*20, so "renders only this page" is testable by slug.
const ALL_PRODUCTS = Array.from({ length: 160 }, (_, index) => {
  const n = index + 1;
  if (n === 1) return product;
  if (n === 2) return secondProduct;
  return {
    ...product,
    id: n,
    name: `کالا ${n}`,
    slug: `product-${n}`,
    sku: `SKU-${n}`,
    primary_image: null,
    images: [],
  };
});
const PAGE_SIZE = 20;
const LAST_PAGE = Math.ceil(ALL_PRODUCTS.length / PAGE_SIZE);

const categories = [
  { id: 1, name: "آشپزخانه", slug: "kitchen", is_catalog_root: true, parent_slug: null, image: null },
  { id: 2, name: "قابلمه", slug: "pots", parent_slug: "kitchen", image: null },
];

let server;
let received;
// Tracks how many listing requests are open at once: the pager must walk the
// pages sequentially (or at most 2 at a time), never fire them all at once.
let inFlight = 0;
let maxInFlight = 0;
let brandMode = "ok";
let failProducts = false;
// The fake listing reports `next`/`previous` exactly like DRF does (null at the
// ends). `nextBeyondLast` simulates a listing whose count disagrees with its
// data: `next` stays set while the following page answers 404.
let nextBeyondLast = false;
let previousInternalApiUrl;

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function handle(req, res) {
  const url = new URL(req.url, "http://internal");
  const path = decodeURIComponent(url.pathname);

  if (path === "/api/v1/site/settings/") return sendJson(res, 200, { phone: "02112345678", seo_title: "کازین گالری" });
  if (path === "/api/v1/site/content/") return sendJson(res, 200, { brand: { name: "کازین گالری" }, theme: { css_variables: {} } });
  if (path === "/api/v1/categories/") return sendJson(res, 200, { results: categories });
  if (path === "/api/v1/categories/tree/") return sendJson(res, 200, { results: [] });
  if (path === "/api/v1/brands/") return sendJson(res, 200, { results: [{ id: 1, name: "مس‌کاران", slug: "mes-karan" }] });
  if (path === "/api/v1/products/facets/") {
    return sendJson(res, 200, { results: [{ slug: "rang", name: "رنگ", values: [{ value: "مسی", count: 1 }] }] });
  }
  if (path === "/api/v1/banners/") return sendJson(res, 200, { results: [{ id: 1, title: "بنر" }] });
  if (path === "/api/v1/banners/daily-deals/") {
    return sendJson(res, 200, { server_now: "2026-10-21T12:00:00Z", results: [{ id: 9, product, sale_price: 99000, ends_at: "2026-10-22T12:00:00Z" }] });
  }
  if (path === "/api/v1/products/") {
    if (failProducts) return sendJson(res, 503, { detail: "down" });
    const raw = url.searchParams.get("page");
    const requested = Number(raw || "1");
    // DRF answers 404 -- "Invalid page" -- past the end.
    if (!Number.isInteger(requested) || requested < 1 || requested > LAST_PAGE) {
      return sendJson(res, 404, { detail: "Invalid page." });
    }
    const start = (requested - 1) * PAGE_SIZE;
    const results = ALL_PRODUCTS.slice(start, start + PAGE_SIZE);
    const hasNext = nextBeyondLast || requested < LAST_PAGE;
    const nextParams = new URLSearchParams(url.search);
    nextParams.set("page", String(requested + 1));
    const prevParams = new URLSearchParams(url.search);
    prevParams.set("page", String(requested - 1));
    // The listing echoes what it was asked for, so "params arrived unchanged"
    // can be asserted from the request the upstream really received.
    return sendJson(res, 200, {
      count: ALL_PRODUCTS.length,
      next: hasNext ? `http://internal/api/v1/products/?${nextParams}` : null,
      previous: requested > 1 ? `http://internal/api/v1/products/?${prevParams}` : null,
      results,
      price_bounds: { min: 1000, max: 5000000 },
      price_range: { min: TOOMAN_PRICE, max: 90000 },
      echo: url.search,
    });
  }
  if (path === `/api/v1/products/${product.slug}/`) return sendJson(res, 200, product);
  if (path === "/api/v1/products/unknown-product/") return sendJson(res, 404, { detail: "Not found." });
  if (path === "/api/v1/brands/mes-karan/") {
    if (brandMode === "missing") return sendJson(res, 404, { detail: "Not found." });
    return sendJson(res, 200, { id: 1, name: "مس‌کاران", slug: "mes-karan", logo: null, tile_image: null });
  }
  if (/^\/api\/v1\/reviews\/product\/\d+\/summary\/$/.test(path)) {
    return sendJson(res, 200, { count: 3, average_rating: 4.5 });
  }
  if (/^\/api\/v1\/reviews\/product\/\d+\/$/.test(path)) {
    return sendJson(res, 200, {
      count: 3,
      next: null,
      results: [{ id: 1, username: "خریدار", rating: 5, title: "عالی", body: "خیلی خوب بود", created_at: "2026-10-01T10:00:00Z", is_verified_purchase: true }],
    });
  }
  return sendJson(res, 404, { detail: "no route" });
}

beforeAll(async () => {
  received = [];
  server = http.createServer((req, res) => {
    received.push({ url: req.url, headers: { ...req.headers } });
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    res.on("close", () => {
      inFlight -= 1;
    });
    handle(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  previousInternalApiUrl = process.env.INTERNAL_API_URL;
  process.env.INTERNAL_API_URL = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (previousInternalApiUrl === undefined) delete process.env.INTERNAL_API_URL;
  else process.env.INTERNAL_API_URL = previousInternalApiUrl;
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  received.length = 0;
  cacheStore.clear();
  cacheOptions.length = 0;
  inFlight = 0;
  maxInFlight = 0;
  brandMode = "ok";
  failProducts = false;
  nextBeyondLast = false;
  headersMock.mockImplementation(async () => new Headers({ host: "shop.example:8080", "x-forwarded-proto": "https" }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const urls = () => received.map((request) => request.url);
const shopArgs = (searchParams) => ({ searchParams: Promise.resolve(searchParams) });
const slugArgs = (slug) => ({ params: Promise.resolve({ slug }) });

it("server-renders the shop grid, count and prices from the query", async () => {
  const html = renderToStaticMarkup(await ShopPage(shopArgs({ category: "pots" })));

  expect(html).toContain(product.name);
  expect(html).toContain(secondProduct.name);
  expect(html).toContain(formatPrice(TOOMAN_PRICE));
  expect(html).toContain(formatPrice(90000));
  expect(html).toContain("تومان");
  expect(html).toContain('href="/products/copper-pot/"');
  // Structure/classes are the SPA's, and BOTH responsive variants ship.
  expect(html).toContain("shop__sidebar");
  expect(html).toContain("shop__mobile-bar");
  expect(html).toContain("product-card--desktop");
  expect(html).toContain("product-card--compact");
  // Breadcrumbs for the filtered category, and its JSON-LD twin.
  expect(html).toContain("آشپزخانه");
  expect(html).toContain("breadcrumb-jsonld");
  // Live mobile audit: a screen-reader-only «محصولات» heading names the grid,
  // and it comes BEFORE the grid in document order.
  const productsHeading = html.indexOf('<h2 class="sr-only">محصولات</h2>');
  expect(productsHeading).toBeGreaterThan(-1);
  expect(productsHeading).toBeLessThan(html.indexOf('class="product-grid"'));
});

it("forwards every filter and sort parameter to Django unchanged", async () => {
  const searchParams = {
    category: "pots",
    brand: "mes-karan",
    min_price: "10000",
    max_price: "900000",
    in_stock: "true",
    on_sale: "1",
    ordering: "price_asc",
    search: "قابلمه",
    attr_rang: "مسی,نقره‌ای",
  };
  await ShopPage(shopArgs(searchParams));

  const listing = received.find((request) => request.url.startsWith("/api/v1/products/?"));
  const query = new URL(listing.url, "http://internal").searchParams;
  for (const [key, value] of Object.entries(searchParams)) {
    expect(query.get(key)).toBe(value); // spelling preserved: on_sale=1 survives
  }
  // Facets follow the selected category + brand scope.
  const facets = new URL(urls().find((url) => url.startsWith("/api/v1/products/facets/")), "http://internal").searchParams;
  expect(facets.get("category")).toBe("pots");
  expect(facets.get("brand")).toBe("mes-karan");
});

it("renders ONLY the requested page: ?page=3 is items 41-60, one listing call", async () => {
  const html = renderToStaticMarkup(await ShopPage(shopArgs({ page: "3" })));

  const listing = urls().filter((url) => url.startsWith("/api/v1/products/?"));
  expect(listing).toHaveLength(1);
  expect(new URL(listing[0], "http://internal").searchParams.get("page")).toBe("3");

  // Items 41-60, exactly like the SPA's page 3 -- not 1-60.
  expect(html).toContain('href="/products/product-41/"');
  expect(html).toContain('href="/products/product-60/"');
  expect(html).not.toContain('href="/products/product-40/"');
  expect(html).not.toContain('href="/products/product-61/"');
  expect(html).not.toContain('href="/products/product-1/"');
  // The desktop pager can reach all 8 pages, next/prev included.
  expect(html).toContain('href="/shop/?page=2"');
  expect(html).toContain('href="/shop/?page=4"');
  expect(html).toContain('href="/shop/?page=8"');
  expect(html).not.toContain('href="/shop/?page=9"');
});

it("serves the last page: ?page=8 is items 141-160, still one listing call", async () => {
  const html = renderToStaticMarkup(await ShopPage(shopArgs({ page: "8" })));

  expect(urls().filter((url) => url.startsWith("/api/v1/products/?"))).toHaveLength(1);
  expect(html).toContain('href="/products/product-141/"');
  expect(html).toContain('href="/products/product-160/"');
  expect(html).not.toContain('href="/products/product-140/"');
  // No next page: the pager stops at 8 and the phone button is gone.
  expect(html).not.toContain('href="/shop/?page=9"');
  expect(html).not.toContain("shop__load-more");
  expect(html).toContain("صفحه ۸ از ۸");
});

it("308s a page past the last one to the real last page (one extra request)", async () => {
  const error = await ShopPage(shopArgs({ category: "pots", page: "99" })).catch((thrown) => thrown);

  expect(error.statusCode).toBe(308);
  expect(error.redirectUrl).toBe("/shop/?category=pots&page=8");
  // The 404 for page 99 plus ONE page-1 request that supplies `count`.
  const listing = urls().filter(
    (url) => url === "/api/v1/products/" || url.startsWith("/api/v1/products/?")
  );
  expect(listing).toHaveLength(2);
  expect(listing[0]).toContain("page=99");
  expect(new URL(listing[1], "http://internal").searchParams.get("page")).toBeNull();
});

it("drops an invalid ?page (abc, 0, -2, 3.5) with a 308 and no upstream call", async () => {
  for (const value of ["abc", "0", "-2", "3.5", "007"]) {
    received.length = 0;
    const error = await ShopPage(shopArgs({ category: "pots", page: value })).catch((thrown) => thrown);
    expect(error.statusCode).toBe(308);
    expect(error.redirectUrl).toBe("/shop/?category=pots");
    expect(urls()).toEqual([]);
  }
});

it("noindexes ?page=N listings, keeps the canonical page-less and links prev/next", async () => {
  const paged = await shopMetadataFor(shopArgs({ category: "pots", page: "3" }));
  expect(paged.robots).toEqual({ index: false, follow: true });
  expect(paged.alternates.canonical).toBe("https://cusin.ir/shop/?category=pots");

  const first = await shopMetadataFor(shopArgs({ category: "pots" }));
  expect(first.robots).toBeUndefined();
  expect(first.alternates.canonical).toBe("https://cusin.ir/shop/?category=pots");

  // Paged listings advertise their neighbours in the HTML itself.
  const html = renderToStaticMarkup(await ShopPage(shopArgs({ category: "pots", page: "3" })));
  expect(html).toMatch(/<link rel="prev" href="\/shop\/\?category=pots&amp;page=2"\/>/);
  expect(html).toMatch(/<link rel="next" href="\/shop\/\?category=pots&amp;page=4"\/>/);

  const lastPage = renderToStaticMarkup(await ShopPage(shopArgs({ page: "8" })));
  expect(lastPage).toMatch(/<link rel="prev" href="\/shop\/\?page=7"\/>/);
  expect(lastPage).not.toMatch(/<link rel="next"/);

  const firstPage = renderToStaticMarkup(await ShopPage(shopArgs({})));
  expect(firstPage).not.toMatch(/<link rel="prev"/);
  expect(firstPage).toMatch(/<link rel="next" href="\/shop\/\?page=2"\/>/);

  // The brand listing shares the pager, so it shares the rule.
  const { generateMetadata: brandMetadataFor } = await import("../app/brands/[slug]/page");
  const brandMeta = await brandMetadataFor({
    ...slugArgs("mes-karan"),
    searchParams: Promise.resolve({ page: "2" }),
  });
  expect(brandMeta.robots).toEqual({ index: false, follow: true });
  expect(brandMeta.alternates.canonical).toBe("https://cusin.ir/brands/mes-karan/");
});

it("server-renders a product page with its price, offers and structured data", async () => {
  const html = renderToStaticMarkup(await ProductPage(slugArgs(product.slug)));

  expect(html).toContain("قابلمه مسی دست‌ساز");
  expect(html).toContain(formatPrice(TOOMAN_PRICE));
  expect(html).toContain("مس");
  expect(html).toContain("نظرات کاربران");
  expect(html).toContain("خریدار");
  expect(html).toContain("breadcrumb-jsonld");
  expect(html).toContain("product-jsonld");
  // Both content-section variants exist before hydration.
  expect(html).toContain("product-detail__section--collapsible");
  expect(html).toContain("product-detail__section--static");

  const match = html.match(/<script type="application\/ld\+json" id="product-jsonld">([\s\S]*?)<\/script>/);
  expect(match).not.toBeNull();
  const jsonLd = JSON.parse(match[1]);
  expect(jsonLd["@type"]).toBe("Product");
  expect(jsonLd.name).toBe(product.name);
  expect(jsonLd.sku).toBe(product.sku);
  expect(jsonLd.brand).toEqual({ "@type": "Brand", name: "مس‌کاران" });
  // Toman on the page, Rial in the structured data (×10, ISO currency).
  expect(jsonLd.offers.priceCurrency).toBe("IRR");
  expect(jsonLd.offers.price).toBe(String(TOOMAN_PRICE * 10));
  expect(jsonLd.offers.availability).toBe("https://schema.org/InStock");
  expect(jsonLd.offers.url).toMatch(/\/products\/copper-pot\/$/);
  expect(jsonLd.image[0]).toMatch(/^https?:\/\/.+\/media\/copper-800\.webp$/);
});

it("answers an unknown product slug with a REAL 404, not an empty page", async () => {
  await expect(ProductPage(slugArgs("unknown-product"))).rejects.toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });

  // The Persian 404 design is the same one the SPA rendered, and it is noindex.
  const html = renderToStaticMarkup(<NotFound />);
  expect(html).toContain("notfound");
  expect(html).toContain("۴۰۴");
  expect(html).toContain("صفحه مورد نظر پیدا نشد؛ شاید نشانی عوض شده است.");
  expect(html).toContain('href="/"');
});

it("404s an unknown brand and renders the brand listing for a real one", async () => {
  brandMode = "missing";
  await expect(BrandPage({ ...slugArgs("mes-karan"), searchParams: Promise.resolve({}) })).rejects.toMatchObject({
    digest: "NEXT_HTTP_ERROR_FALLBACK;404",
  });

  brandMode = "ok";
  const html = renderToStaticMarkup(
    await BrandPage({ ...slugArgs("mes-karan"), searchParams: Promise.resolve({ ordering: "price_asc" }) })
  );
  expect(html).toContain("محصولات برند");
  expect(html).toContain(product.name);
  // The brand scope rides on the URL path, not as a duplicated ?brand= filter.
  const listing = new URL(urls().find((url) => url.startsWith("/api/v1/products/?")), "http://internal").searchParams;
  expect(listing.get("brand")).toBe("mes-karan");
  expect(listing.get("ordering")).toBe("price_asc");
  // The pager keeps the filter/sort query but never duplicates ?brand=.
  expect(html).toContain('href="/brands/mes-karan/?ordering=price_asc&amp;page=2"');
  expect(html).toContain('href="/brands/mes-karan/?ordering=price_asc&amp;page=8"');
  expect(html).not.toContain("?brand=mes-karan");
  // The brand listing shares ShopView, so it carries the same hidden heading
  // before its product grid.
  const brandProductsHeading = html.indexOf('<h2 class="sr-only">محصولات</h2>');
  expect(brandProductsHeading).toBeGreaterThan(html.indexOf("محصولات برند"));
  expect(brandProductsHeading).toBeLessThan(html.indexOf('class="product-grid"'));
});

it("keeps a stable shop canonical for filtered pages and a self canonical per product", async () => {
  const filtered = await shopMetadataFor(shopArgs({ category: "pots", min_price: "1000", ordering: "price_desc", page: "3" }));
  expect(filtered.alternates.canonical).toBe("https://cusin.ir/shop/?category=pots");

  const plain = await shopMetadataFor(shopArgs({ search: "قابلمه", page: "2" }));
  expect(plain.alternates.canonical).toBe("https://cusin.ir/shop/");

  const { generateMetadata: productMetadataFor } = await import("../app/products/[slug]/page");
  const meta = await productMetadataFor(slugArgs(product.slug));
  expect(meta.alternates.canonical).toBe("https://cusin.ir/products/copper-pot/");
  expect(meta.openGraph.images[0]).toContain("/media/copper-800.webp");
});

it("reads daily deals and banners on EVERY render but caches products for 60s", async () => {
  const count = (needle) => urls().filter((url) => url === needle || url.startsWith(`${needle}?`)).length;

  await getHomeData();
  expect(count("/api/v1/banners/daily-deals/")).toBe(1);
  expect(count("/api/v1/banners/")).toBe(1);
  const cachedProducts = count("/api/v1/products/?is_featured=true");
  expect(cachedProducts).toBe(1);

  // A second render inside the cache window: deals must be re-read (an owner
  // edit shows immediately, and server_now -- the countdown's base -- is
  // never stale), while the 60s catalog cache keeps serving products.
  await getHomeData();
  expect(count("/api/v1/banners/daily-deals/")).toBe(2);
  expect(count("/api/v1/banners/")).toBe(2);
  expect(count("/api/v1/products/?is_featured=true")).toBe(cachedProducts);

  // Public caching is still the 60s policy for the cached resources only.
  expect(cacheOptions.every((options) => options.revalidate === 60)).toBe(true);
  // Uncached calls stay cookie-free, exactly like the cached public ones.
  const dealsRequest = received.find((request) => request.url.startsWith("/api/v1/banners/daily-deals/"));
  expect(dealsRequest.headers.cookie).toBeUndefined();
  expect(dealsRequest.headers.host).toBe("shop.example:8080");

  // apiServer(noCache) is the mechanism, and it is not a private call.
  received.length = 0;
  await apiServer("/api/v1/banners/daily-deals/", { noCache: true });
  await apiServer("/api/v1/banners/daily-deals/", { noCache: true });
  expect(urls()).toHaveLength(2);
  expect(received[0].headers.cookie).toBeUndefined();
});

it("degrades to the retry state instead of crashing when the listing API fails", async () => {
  failProducts = true;
  const html = renderToStaticMarkup(await ShopPage(shopArgs({})));
  expect(html).toContain('class="shop"');
  expect(html).toContain("empty-state--error");
  expect(html).toContain("تلاش دوباره");
});
