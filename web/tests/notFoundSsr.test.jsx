import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Server-rendered 404s for the catalog detail routes.
 *
 * Next 16.4 answers `notFound()` with status 404 and an EMPTY document — the
 * Persian 404 only arrives in the RSC payload, i.e. after hydration (see
 * vercel/next.js#99287). `proxy.js` therefore asks Django whether the slug
 * exists and, for a missing one, rewrites to `/not-found-page/` with the 404
 * status kept. These tests pin that contract and the content of the document
 * it rewrites to, so the header/footer and the Persian text cannot silently
 * drop out of the first response again.
 */
const { existsMock, infoExistsMock } = vi.hoisted(() => ({
  existsMock: vi.fn(),
  infoExistsMock: vi.fn(),
}));

vi.mock("../lib/catalog-availability", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    catalogSlugExists: existsMock,
    infoPageExists: infoExistsMock,
  };
});

// The layout shell is a client tree; only the router primitives it reads are
// doubled here (the same strategy as the shop tests).
vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...props }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/products/missing/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

import { config, proxy } from "../proxy";
import NotFound from "../app/not-found";
import NotFoundRoute, { metadata as notFoundPageMetadata } from "../app/not-found-page/page";
import MainLayout from "../layouts/MainLayout";

const requestFor = (pathname, headers = {}) =>
  new Request(new URL(pathname, "https://cusin.ir"), { headers });

beforeEach(() => {
  existsMock.mockReset();
});

describe("proxy: catalog slugs that Django says are gone", () => {
  it("keeps the 404 status and rewrites to the server-rendered 404 page", async () => {
    existsMock.mockResolvedValue(false);

    const response = await proxy(requestFor("/products/unknown-product/"));

    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://cusin.ir/_not-found/");
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(existsMock).toHaveBeenCalledWith("products", "unknown-product", expect.any(Object));
  });

  it("does the same for brands", async () => {
    existsMock.mockResolvedValue(false);

    const response = await proxy(requestFor("/brands/nope/"));

    expect(response.status).toBe(404);
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://cusin.ir/_not-found/");
    expect(existsMock).toHaveBeenCalledWith("brands", "nope", expect.any(Object));
  });

  it("lets an existing slug through untouched", async () => {
    existsMock.mockResolvedValue(true);

    const response = await proxy(requestFor("/products/copper-pot/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("fails OPEN when the catalog API cannot answer", async () => {
    // null = timeout/5xx/socket error: never turn an API hiccup into a 404.
    existsMock.mockResolvedValue(null);

    const response = await proxy(requestFor("/products/copper-pot/"));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.status).toBe(200);
  });

  it("passes RSC navigations through to the real route", async () => {
    existsMock.mockResolvedValue(false);

    const response = await proxy(requestFor("/products/unknown-product/", { rsc: "1" }));
    const prefetch = await proxy(requestFor("/products/unknown-product/", { "next-router-prefetch": "1" }));

    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(prefetch.headers.get("x-middleware-next")).toBe("1");
    expect(existsMock).not.toHaveBeenCalled();
  });

  it("only handles the canonical detail page, not sub-paths or other verbs", async () => {
    existsMock.mockResolvedValue(false);

    const deeper = await proxy(requestFor("/products/unknown-product/reviews/"));
    const listing = await proxy(requestFor("/products/"));
    // No trailing slash: Next's own 308 to the canonical URL must run first.
    const slashless = await proxy(requestFor("/products/unknown-product"));
    const posted = await proxy(
      new Request(new URL("/products/unknown-product/", "https://cusin.ir"), { method: "POST" })
    );

    expect(deeper.headers.get("x-middleware-next")).toBe("1");
    expect(listing.headers.get("x-middleware-next")).toBe("1");
    expect(slashless.headers.get("x-middleware-next")).toBe("1");
    expect(posted.headers.get("x-middleware-next")).toBe("1");
    expect(existsMock).not.toHaveBeenCalled();
  });

  it("decodes the slug exactly once before asking the API", async () => {
    existsMock.mockResolvedValue(false);

    await proxy(requestFor("/products/%D9%85%D8%B3%DB%8C/"));
    // A malformed escape stays a normal request instead of crashing the proxy.
    const broken = await proxy(requestFor("/products/%E0%A4%A/"));

    expect(existsMock).toHaveBeenCalledWith("products", "مسی", expect.any(Object));
    expect(broken.headers.get("x-middleware-next")).toBe("1");
  });

  it("rewrites an unpublished info page to /_not-found/ with status 404 and fails open on upstream error", async () => {
    infoExistsMock.mockResolvedValueOnce(false);
    const missing = await proxy(
      requestFor("/terms/", {
        host: "cusin.ir",
        "x-forwarded-proto": "https",
        "x-forwarded-for": "203.0.113.5",
      })
    );
    expect(infoExistsMock).toHaveBeenCalledWith("terms", {
      host: "cusin.ir",
      proto: "https",
      forwardedFor: "203.0.113.5",
    });
    expect(missing.status).toBe(404);
    expect(missing.headers.get("x-middleware-rewrite")).toBe(
      "https://cusin.ir/_not-found/"
    );

    infoExistsMock.mockResolvedValueOnce(null);
    const outage = await proxy(requestFor("/about/", { host: "cusin.ir" }));
    expect(outage.status).toBe(200);
    expect(outage.headers.get("x-middleware-next")).toBe("1");
  });

  it("runs on catalog, info, and phase-3a/3b private/auth prefixes", () => {
    expect(config.matcher).toEqual([
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
    ]);
  });
});

describe("the document the rewrite renders", () => {
  it("is the same Persian 404 as the framework boundary", () => {
    const html = renderToStaticMarkup(<NotFoundRoute />);

    expect(html).toBe(renderToStaticMarkup(<NotFound />));
    expect(html).toContain("۴۰۴");
    expect(html).toContain("صفحه مورد نظر پیدا نشد؛ شاید نشانی عوض شده است.");
    expect(html).toContain('href="/"');
  });

  it("carries «یافت نشد» and is noindex", () => {
    expect(notFoundPageMetadata.title).toContain("یافت نشد");
    // noindex AND nofollow: a 404 must never invite a crawl of the dead URL.
    expect(notFoundPageMetadata.robots).toEqual({ index: false, follow: false });
  });

  it("is rendered inside the storefront shell, so the server HTML has the header", () => {
    const html = renderToStaticMarkup(
      <MainLayout>
        <NotFound />
      </MainLayout>
    );

    expect(html).toContain('class="site-header');
    expect(html).toContain("site-header__brand");
    expect(html).toContain('class="notfound"');
    expect(html).toContain("۴۰۴");
    expect(html).toContain("site-footer");
  });
});
