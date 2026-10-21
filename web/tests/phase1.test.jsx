import http from "node:http";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

// Server-side Django calls run over REAL HTTP against a throwaway node:http
// server (see tests/api-server.test.jsx). The previous global-fetch mock hid
// the production bug it claimed to cover: undici ignores a user-supplied Host
// header, so Django answered every server-side call with DisallowedHost 400.
// Only Next's request/cache primitives are doubled (they need the Next
// runtime); the next/cache double is a faithful keyParts+args in-memory cache
// that never caches rejections, mirroring unstable_cache.
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
      const value = await cb(...args);
      cacheStore.set(key, JSON.stringify(value));
      return value;
    };
  },
}));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, prefetch, children, ...props }) => <a href={href} {...props}>{children}</a> }));
import HomePage, { generateMetadata } from "../app/page";
import RootLayout from "../app/layout";
import { NavLink, Link } from "../lib/navigation";
import { apiServer, allPages } from "../lib/api-server";
import { formatPrice } from "../utils/formatPrice";

const product = { id: 1, name: "قابلمه مسی", slug: "copper-pot", stock_status: "in_stock", price_info: { price: 125000, compare_at_price: 150000 } };

let server;
let received;
let failAll = false;
let paginateBanners = false;
let previousInternalApiUrl;

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

beforeAll(async () => {
  received = [];
  server = http.createServer((req, res) => {
    received.push({ method: req.method, url: req.url, headers: { ...req.headers } });
    if (failAll) return sendJson(res, 503, { detail: "upstream down" });
    const url = new URL(req.url, "http://internal");
    const path = url.pathname;
    let data = { results: [] };
    if (path === "/api/v1/site/settings/") data = { phone: "02112345678" };
    if (path === "/api/v1/site/content/") data = { brand: { name: "کازین گالری" }, theme: { css_variables: { "--color-primary": "#123456", "--radius-sm": "8px" } } };
    if (path === "/api/v1/products/") data = { results: [product] };
    if (path === "/api/v1/banners/daily-deals/") data = { server_now: "2026-10-21T12:00:00Z", results: [{ id: 3, product, sale_price: 99000, ends_at: "2026-10-22T12:00:00Z" }] };
    if (path === "/api/v1/banners/" && paginateBanners) {
      data = url.searchParams.get("page") === "2"
        ? { results: [2], next: null }
        : { results: [1], next: "https://shop.example/api/v1/banners/?page=2" };
    }
    return sendJson(res, 200, data);
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
  failAll = false;
  paginateBanners = false;
  headersMock.mockImplementation(async () => new Headers({ host: "shop.example:8080", "x-forwarded-proto": "https", cookie: "sessionid=private" }));
  // apiServer logs one line per upstream failure; the dedicated api-server
  // suite asserts that output, here it would only drown the test report.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("renders the async home page's product names, Toman prices and deals in server HTML", async () => {
  const html = renderToStaticMarkup(await HomePage());
  expect(html).toContain(product.name);
  expect(html).toContain(formatPrice(125000));
  expect(html).toContain(formatPrice(99000));
  expect(html).toContain("تومان");
  expect(html).toContain('href="/products/copper-pot/"');
  expect(html).toContain("deals-cf__stage");
});
it("inlines owner theme on the RTL html element before any effects", async () => {
  const html = renderToStaticMarkup(await RootLayout({ children: <p>home</p> }));
  expect(html).toContain('lang="fa" dir="rtl" style="--color-primary:#123456;--radius-sm:8px"');
  expect(html).toContain("site-header");
});
it("applies NavLink active classes and uses document links for SPA routes", () => {
  const html = renderToStaticMarkup(<><NavLink to="/" end className={({ isActive }) => isActive ? "selected" : "idle"}>home</NavLink><NavLink to="/shop/">shop</NavLink><Link to="/cart/">cart</Link></>);
  expect(html).toContain('aria-current="page" class="selected"');
  expect(html).toContain('href="/shop/" class=""');
  expect(html).toContain('href="/cart/"');
  expect(html.match(/aria-current/g)).toHaveLength(1);
});
it("forwards public Host, caches public data, and isolates private requests", async () => {
  await apiServer("/api/v1/products/");
  let request = received.at(-1);
  // What the upstream actually received over the socket (the old fetch mock
  // asserted the options object instead, which undici silently ignored).
  expect(request.headers.host).toBe("shop.example:8080");
  expect(request.headers["x-forwarded-proto"]).toBe("https");
  expect(request.headers.cookie).toBeUndefined();
  expect(cacheOptions.at(-1)).toEqual({ revalidate: 60 });
  const hitsAfterPublic = received.length;
  await apiServer("/api/v1/products/");
  expect(received).toHaveLength(hitsAfterPublic); // public repeat served from the 60s cache
  await apiServer("/api/v1/accounts/me/", { privateData: true });
  request = received.at(-1);
  expect(request.headers.host).toBe("shop.example:8080");
  expect(request.headers.cookie).toBe("sessionid=private");
  const hitsAfterPrivate = received.length;
  await apiServer("/api/v1/accounts/me/", { privateData: true });
  expect(received).toHaveLength(hitsAfterPrivate + 1); // private calls are never cached
});
it("follows paginated public collections only through the internal Django host", async () => {
  paginateBanners = true;
  expect((await allPages("/api/v1/banners/")).results).toEqual([1, 2]);
  // The absolute `next` (https://shop.example/...) is re-based onto the
  // internal upstream: both pages arrived at this test server.
  expect(received.map(({ url }) => url)).toEqual(["/api/v1/banners/", "/api/v1/banners/?page=2"]);
});
it("emits the current home canonical and social image", async () => {
  const metadata = await generateMetadata();
  expect(metadata.alternates.canonical).toBe("https://cusin.ir/");
  expect(metadata.openGraph.images).toEqual(["/brand/og.png"]);
});
it("keeps the home shell and retry UI usable when public APIs fail", async () => {
  failAll = true;
  const html = renderToStaticMarkup(await HomePage());
  expect(html).toContain('class="home"');
  expect(html).toContain("empty-state--error");
  expect(html).toContain("تلاش دوباره");
});
it("rejects absolute API destinations", async () => {
  await expect(apiServer("https://other.example/api/v1/products/")).rejects.toThrow("relative Django API path");
});
it("server-renders both deals variants and both product-card variants before hydration", async () => {
  const html = renderToStaticMarkup(await HomePage());
  expect(html).toContain('class="deals-desktop"');
  expect(html).toContain('class="deals-mobile"');
  expect(html).toContain("product-card--desktop");
  expect(html).toContain("product-card--compact");
});
