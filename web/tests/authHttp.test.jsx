import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, expect, it } from "vitest";
import { safeNext } from "../lib/auth-navigation";

// Real production Next HTTP -> real node:http Django. No browser, fetch
// mocks, backend suite or shared-cache doubles. Run npm run build first.
let django, next, origin, calls = [], down = false, logs = "";
const user = { id: 7, first_name: "آزمایش", last_name: "کاربر", email: "test@example.com", phone: "09123456789" };
async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}
async function get(path, cookie) {
  return new Promise((resolve, reject) => {
    http.get(origin + path, { headers: cookie ? { Cookie: cookie } : {} }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject);
  });
}
beforeAll(async () => {
  django = http.createServer((req, res) => {
    if (req.url === "/api/v1/accounts/me/") {
      calls.push({ ...req.headers });
      if (down) { req.socket.destroy(); return; }
      res.setHeader("Content-Type", "application/json");
      const match = /sessionid=(\w+)/.exec(req.headers.cookie || "");
      res.end(JSON.stringify(match ? { ...user, first_name: match[1] } : { user: null }));
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(req.url.includes("/settings/") ? {} : req.url.includes("/content/") ? {} : { results: [] }));
  });
  const apiPort = await listen(django);
  const reserve = http.createServer();
  const port = await listen(reserve);
  await new Promise(resolve => reserve.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: process.cwd(), env: { ...process.env, INTERNAL_API_URL: `http://127.0.0.1:${apiPort}`, NEXT_TELEMETRY_DISABLED: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Next startup timed out: ${logs}`)), 30000);
    const onData = chunk => {
      logs += chunk;
      if (/Ready in/.test(logs)) { clearTimeout(timer); resolve(); }
    };
    next.stdout.on("data", onData);
    next.stderr.on("data", onData);
    next.once("exit", code => { clearTimeout(timer); reject(new Error(`Next exited ${code}: ${logs}`)); });
  });
}, 40000);
afterAll(async () => {
  if (next && next.exitCode === null) {
    await new Promise(resolve => { next.once("exit", resolve); next.kill("SIGTERM"); });
  }
  if (django) await new Promise(resolve => { django.closeAllConnections(); django.close(resolve); });
});
beforeEach(() => { calls = []; down = false; });

it("anonymous GET preserves the exact original path+query in its 307", async () => {
  const response = await get("/account/orders/?x=1");
  expect(response.status).toBe(307);
  expect(response.headers.location).toBe("/login/?next=%2Faccount%2Forders%2F%3Fx%3D1");
  expect(response.headers["cache-control"]).toContain("no-store");
});
it("forwards the session cookie and renders the account header on first paint", async () => {
  const response = await get("/account/", "sessionid=alice; csrftoken=test");
  expect(response.status).toBe(200);
  expect(calls).toHaveLength(1);
  expect(calls[0].cookie).toBe("sessionid=alice; csrftoken=test");
  expect(calls[0].host).toBe(new URL(origin).host);
  const document = response.body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  expect(document).toContain("alice");
  expect(document).not.toContain("ورود | ثبت‌نام");
  expect(document).toContain('value="alice"');
});
it("never caches or shares the me-probe between different cookies", async () => {
  const a = await get("/account/", "sessionid=alice");
  const b = await get("/account/", "sessionid=bob");
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);
  expect(calls.map(c => c.cookie)).toEqual(["sessionid=alice", "sessionid=bob"]);
  expect(b.body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")).toContain('value="bob"');
  expect(b.body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")).not.toContain("alice");
});
it("Django down fails open, never redirects", async () => {
  down = true;
  const response = await get("/account/", "sessionid=alice");
  expect(response.status).toBe(200);
  expect(response.headers.location).toBeUndefined();
  expect(response.body).toContain("در حال بررسی ورود…");
});
it.each(["/login/", "/register/"])("authenticated GET %s redirects to account", async path => {
  const response = await get(path, "sessionid=alice");
  expect(response.status).toBe(307);
  expect(response.headers.location).toBe("/account/");
});
it.each(["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)"])("rejects open redirect %s in login AND register", async value => {
  expect(safeNext(value)).toBe("/");
  for (const route of ["/login/", "/register/"]) {
    const response = await get(`${route}?next=${encodeURIComponent(value)}`, "sessionid=alice");
    expect(response.status).toBe(307);
    expect(response.headers.location).toBe("/");
  }
});
it.each(["/checkout/?step=delivery", "/cart/", "/account/orders/?x=1"])("preserves valid next %s", async value => {
  const response = await get(`/login/?next=${encodeURIComponent(value)}`, "sessionid=alice");
  expect(response.status).toBe(307);
  expect(response.headers.location).toBe(value);
});
it.each(["/account/", "/account/orders/", "/account/orders/999/", "/account/addresses/", "/account/reviews/", "/wishlist/"])("%s is private/no-store and noindex, follow", async path => {
  const response = await get(path, "sessionid=alice");
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.headers["cache-control"]).toContain("private");
  expect(response.body).toMatch(/name="robots" content="noindex, follow"/);
});
it.each(["/login/", "/register/", "/password-reset/", "/reset-password/confirm/?uid=abc&token=old-sent-token"])("%s is dynamic and noindex", async path => {
  const response = await get(path);
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.body).toMatch(/name="robots" content="noindex, follow"/);
});
it("reset confirm retains link-mode uid/token and SMS-mode mode=code&phone", async () => {
  const link = await get("/reset-password/confirm/?uid=legacy-uid&token=legacy-token");
  expect(link.body).toContain("تنظیم رمز عبور جدید");
  expect(link.body).not.toContain("لینک بازیابی معتبر نیست.");
  const sms = await get("/reset-password/confirm/?mode=code&phone=09123456789");
  expect(sms.body).toContain("بازیابی با کد پیامک");
  expect(sms.body).toContain('value="09123456789"');
  const broken = await get("/reset-password/confirm/?uid=only-uid");
  expect(broken.body).toContain("لینک بازیابی معتبر نیست.");
});
it("SPA guard uses document navigation and URL-encoded path+query (no router state)", () => {
  const source = readFileSync(new URL("../../frontend/src/components/ProtectedRoute.jsx", import.meta.url), "utf8");
  expect(source).toContain("`/login/?next=${encodeURIComponent(location.pathname + location.search)}`");
  expect(source).toContain("window.location.replace(target)");
  expect(source).not.toContain("<Navigate");
  const nextRoutes = readFileSync(new URL("../../frontend/src/utils/nextRoutes.jsx", import.meta.url), "utf8");
  for (const prefix of ["/login", "/register", "/password-reset", "/reset-password", "/account", "/wishlist"]) expect(nextRoutes).toContain(`"${prefix}"`);
});
