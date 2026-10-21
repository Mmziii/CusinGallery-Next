import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "shop.example:8080", "x-forwarded-proto": "https", cookie: "sessionid=private" }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/", useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, prefetch, children, ...props }) => <a href={href} {...props}>{children}</a> }));
import HomePage, { generateMetadata } from "../app/page";
import RootLayout from "../app/layout";
import { NavLink, Link } from "../lib/navigation";
import { apiServer, allPages } from "../lib/api-server";
import { formatPrice } from "../utils/formatPrice";

const product = { id: 1, name: "قابلمه مسی", slug: "copper-pot", stock_status: "in_stock", price_info: { price: 125000, compare_at_price: 150000 } };
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url) => {
    const path = new URL(url).pathname;
    let data = { results: [] };
    if (path === "/api/v1/site/settings/") data = { phone: "02112345678" };
    if (path === "/api/v1/site/content/") data = { brand: { name: "کازین گالری" }, theme: { css_variables: { "--color-primary": "#123456", "--radius-sm": "8px" } } };
    if (path === "/api/v1/products/") data = { results: [product] };
    if (path === "/api/v1/banners/daily-deals/") data = { server_now: "2026-10-21T12:00:00Z", results: [{ id: 3, product, sale_price: 99000, ends_at: "2026-10-22T12:00:00Z" }] };
    return { ok: true, json: async () => data };
  }));
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
  let options = fetch.mock.calls.at(-1)[1];
  expect(options.headers.Host).toBe("shop.example:8080");
  expect(options.headers.Cookie).toBeUndefined();
  expect(options.next).toEqual({ revalidate: 60 });
  await apiServer("/api/v1/accounts/me/", { privateData: true });
  options = fetch.mock.calls.at(-1)[1];
  expect(options.cache).toBe("no-store");
  expect(options.next).toBeUndefined();
  expect(options.headers.Cookie).toBe("sessionid=private");
});
it("follows paginated public collections only through the internal Django host", async () => {
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [1], next: "https://shop.example/api/v1/banners/?page=2" }) });
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ results: [2], next: null }) });
  expect((await allPages("/api/v1/banners/")).results).toEqual([1, 2]);
  expect(fetch.mock.calls.at(-1)[0].host).toBe("backend:8000");
});
it("emits the current home canonical and social image", async () => {
  const metadata = await generateMetadata();
  expect(metadata.alternates.canonical).toBe("https://cusin.ir/");
  expect(metadata.openGraph.images).toEqual(["/brand/og.png"]);
});
it("keeps the home shell and retry UI usable when public APIs fail", async () => {
  fetch.mockRejectedValue(new Error("offline"));
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
