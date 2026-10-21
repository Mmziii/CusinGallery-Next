import http from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";

// These tests exercise REAL HTTP against a throwaway node:http server standing
// in for Django. There are deliberately no fetch mocks: the phase-1 fetch mock
// is what hid the undici Host-header bug (Django DisallowedHost 400) in prod.
//
// Only Next's request/cache primitives are doubled, because they require the
// Next server runtime (unstable_cache throws "incrementalCache missing"
// outside it). The next/cache double below is a faithful in-memory cache: it
// keys entries by keyParts + args exactly like Next, stores JSON round-tripped
// values, and never caches rejections — so host-keying assertions are real.
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

import { apiServer } from "../lib/api-server";

const PUBLIC_HOST = "193.5.44.126:8080";
const OTHER_HOST = "shop.example:8080";
const COOKIE = "sessionid=private";

function setIncoming({ host = PUBLIC_HOST, proto = "http", forwardedFor = "198.51.100.23", cookie = COOKIE } = {}) {
  headersMock.mockImplementation(async () =>
    new Headers({
      host,
      "x-forwarded-proto": proto,
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      ...(cookie ? { cookie } : {}),
    })
  );
}

let server;
let internalOrigin;
let received;
let respond;
let previousInternalApiUrl;

function defaultRespond(req, res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ host: req.headers.host, url: req.url, hit: received.length }));
}

beforeAll(async () => {
  received = [];
  respond = defaultRespond;
  server = http.createServer((req, res) => {
    received.push({ method: req.method, url: req.url, headers: { ...req.headers } });
    respond(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  internalOrigin = `http://127.0.0.1:${server.address().port}`;
  previousInternalApiUrl = process.env.INTERNAL_API_URL;
  process.env.INTERNAL_API_URL = internalOrigin;
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
  respond = defaultRespond;
  setIncoming();
});

afterEach(() => {
  vi.restoreAllMocks();
});

it("sends the incoming public Host over real HTTP for a public call — not the internal authority — with proto/XFF and no Cookie", async () => {
  const data = await apiServer("/api/v1/products/?is_featured=true");

  expect(received).toHaveLength(1);
  const [request] = received;
  expect(request.method).toBe("GET");
  expect(request.url).toBe("/api/v1/products/?is_featured=true");
  // The regression: this used to be the internal authority (backend:8000 in
  // prod, 127.0.0.1:<port> here) because undici ignored the fetch Host header.
  expect(request.headers.host).toBe(PUBLIC_HOST);
  expect(request.headers.host).not.toBe(new URL(internalOrigin).host);
  expect(request.headers["x-forwarded-proto"]).toBe("http");
  expect(request.headers["x-forwarded-for"]).toBe("198.51.100.23");
  expect(request.headers.cookie).toBeUndefined();
  expect(data.host).toBe(PUBLIC_HOST);
});

it("forwards the Cookie for a private call and never caches private calls", async () => {
  await apiServer("/api/v1/accounts/me/", { privateData: true });
  await apiServer("/api/v1/accounts/me/", { privateData: true });

  expect(received).toHaveLength(2); // both reached the upstream: no caching
  for (const request of received) {
    expect(request.headers.host).toBe(PUBLIC_HOST);
    expect(request.headers["x-forwarded-proto"]).toBe("http");
    expect(request.headers.cookie).toBe(COOKIE);
  }
  expect(cacheStore.size).toBe(0);
  expect(cacheOptions).toHaveLength(0); // unstable_cache not even engaged
});

it("surfaces a 400 as an error containing the status, logs one line (path + status, no body), and does not cache the failure", async () => {
  respond = (req, res) => {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: "SECRET-BODY-MARKER" }));
  };
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(apiServer("/api/v1/products/?is_featured=true")).rejects.toThrow(
    "Django /api/v1/products/?is_featured=true: 400"
  );
  expect(errorSpy).toHaveBeenCalledTimes(1);
  const logged = errorSpy.mock.calls[0].join(" ");
  expect(logged).toContain("/api/v1/products/?is_featured=true");
  expect(logged).toContain("400");
  expect(logged).not.toContain("SECRET-BODY-MARKER");

  // Failures are not cached: a retry reaches the upstream (and logs) again.
  await expect(apiServer("/api/v1/products/?is_featured=true")).rejects.toThrow("400");
  expect(received).toHaveLength(2);
  expect(errorSpy).toHaveBeenCalledTimes(2);
});

it("caches public calls for the same (path + host) but never shares an entry across public hosts", async () => {
  const path = "/api/v1/products/?is_featured=true";

  const first = await apiServer(path);
  const second = await apiServer(path);
  expect(received).toHaveLength(1); // second call served from cache
  expect(second).toEqual(first);
  expect(cacheOptions.at(-1)).toEqual({ revalidate: 60 });

  setIncoming({ host: OTHER_HOST });
  const otherHost = await apiServer(path);
  expect(received).toHaveLength(2); // different host => its own upstream call
  expect(received[1].headers.host).toBe(OTHER_HOST);
  expect(otherHost.host).toBe(OTHER_HOST); // not the first host's cached body

  setIncoming({ host: PUBLIC_HOST });
  const again = await apiServer(path);
  expect(received).toHaveLength(2); // first host's entry is intact
  expect(again).toEqual(first);

  await apiServer("/api/v1/products/?is_new=true");
  expect(received).toHaveLength(3); // different path => different entry
});

it("does not follow redirects: a 3xx is an error containing the status", async () => {
  respond = (req, res) => {
    res.writeHead(302, { Location: "https://elsewhere.example/api/v1/products/" });
    res.end();
  };
  vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(apiServer("/api/v1/products/")).rejects.toThrow("Django /api/v1/products/: 302");
  expect(received).toHaveLength(1); // Location never chased
});

it("rejects non-/api/v1/ destinations without touching the network", async () => {
  await expect(apiServer("https://other.example/api/v1/products/")).rejects.toThrow("relative Django API path");
  await expect(apiServer("/admin/")).rejects.toThrow("relative Django API path");
  expect(received).toHaveLength(0);
});
