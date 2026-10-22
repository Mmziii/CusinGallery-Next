import http from "node:http";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

// Real HTTP against a throwaway node:http server (same strategy as the
// api-server suite): the proxy's existence check must send the public Host,
// decode the slug for the API path and most of all must never mistake an
// upstream failure for a missing product.
import {
  CATALOG_KINDS,
  INFO_PAGE_SLUGS,
  catalogPath,
  catalogSlugExists,
  infoPageExists,
  infoPagePath,
  resetCatalogAvailability,
} from "../lib/catalog-availability";

let server;
let received;
let respond;
let previousInternalApiUrl;

beforeAll(async () => {
  received = [];
  respond = (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  };
  server = http.createServer((req, res) => {
    received.push({ method: req.method, url: req.url, headers: { ...req.headers } });
    respond(req, res);
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

afterEach(() => {
  resetCatalogAvailability();
  received.length = 0;
  respond = (req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end("{}");
  };
  vi.restoreAllMocks();
});

const requestMeta = { host: "cusin.ir", proto: "https", forwardedFor: "198.51.100.7" };

it("only knows the two catalog detail collections", () => {
  expect([...CATALOG_KINDS]).toEqual(["products", "brands"]);
  expect(catalogPath("products", "قابلمه مسی")).toBe(
    `/api/v1/products/${encodeURIComponent("قابلمه مسی")}/`
  );
});

it("reports an existing slug and sends the public Host to Django", async () => {
  await expect(catalogSlugExists("products", "copper-pot", requestMeta)).resolves.toBe(true);

  expect(received).toHaveLength(1);
  expect(received[0].url).toBe("/api/v1/products/copper-pot/");
  // Django validates ALLOWED_HOSTS and builds absolute media URLs from it.
  expect(received[0].headers.host).toBe("cusin.ir");
  expect(received[0].headers["x-forwarded-proto"]).toBe("https");
  expect(received[0].headers["x-forwarded-for"]).toBe("198.51.100.7");
});

it("reports a Django 404 as missing", async () => {
  respond = (req, res) => {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "Not found." }));
  };

  await expect(catalogSlugExists("products", "unknown-product", requestMeta)).resolves.toBe(false);
  await expect(catalogSlugExists("brands", "nope", requestMeta)).resolves.toBe(false);
});

it("treats server errors and timeouts as UNKNOWN, never as missing", async () => {
  respond = (req, res) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end("{}");
  };
  await expect(catalogSlugExists("products", "copper-pot", requestMeta)).resolves.toBeNull();

  resetCatalogAvailability();
  respond = () => {}; // never answers -> the 3s check deadline fires
  const started = Date.now();
  await expect(catalogSlugExists("products", "copper-pot", requestMeta)).resolves.toBeNull();
  expect(Date.now() - started).toBeLessThan(10_000);
}, 20_000);

it("asks at most once per minute per slug", async () => {
  await catalogSlugExists("products", "copper-pot", requestMeta);
  await catalogSlugExists("products", "copper-pot", requestMeta);
  await catalogSlugExists("products", "copper-pot", requestMeta);
  expect(received).toHaveLength(1);

  // A different slug is its own entry.
  await catalogSlugExists("brands", "copper-pot", requestMeta);
  expect(received).toHaveLength(2);
});

it("shares one request between concurrent lookups", async () => {
  respond = (req, res) => {
    setTimeout(() => {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end("{}");
    }, 25);
  };

  const [first, second, third] = await Promise.all([
    catalogSlugExists("products", "unknown-product", requestMeta),
    catalogSlugExists("products", "unknown-product", requestMeta),
    catalogSlugExists("products", "unknown-product", requestMeta),
  ]);

  expect([first, second, third]).toEqual([false, false, false]);
  expect(received).toHaveLength(1);
});

it("checks owner-editable info pages via /api/v1/site/pages/<slug>/ and fails open on errors", async () => {
  expect([...INFO_PAGE_SLUGS]).toEqual([
    "about",
    "contact",
    "shipping-returns",
    "terms",
    "privacy",
  ]);
  expect(infoPagePath("shipping-returns")).toBe("/api/v1/site/pages/shipping-returns/");

  respond = (_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ slug: "about", title: "درباره ما", body: "<p>متن</p>" }));
  };
  expect(await infoPageExists("about", requestMeta)).toBe(true);
  expect(received.at(-1).url).toBe("/api/v1/site/pages/about/");

  respond = (_req, res) => {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "Not found." }));
  };
  expect(await infoPageExists("terms", requestMeta)).toBe(false);

  respond = (_req, res) => {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "unavailable" }));
  };
  expect(await infoPageExists("contact", requestMeta)).toBeNull();
});
