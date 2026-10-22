import http from "node:http";
import { spawn } from "node:child_process";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { formatPrice } from "../utils/formatPrice";

let django;
let nextProc;
let origin;
let down = false;
let calls = [];

const USERS = {
  alice: { id: 7, phone: "09123456789", email: "alice@example.com", first_name: "alice", last_name: "رضایی" },
  bob: { id: 8, phone: "09120001111", email: "bob@example.com", first_name: "bob", last_name: "کریمی" },
};

const CARTS = {
  alice: {
    item_count: 2,
    subtotal: 680000,
    items: [
      {
        id: 501,
        quantity: 2,
        available_stock: 5,
        is_available: true,
        line_total: 680000,
        product: { id: 11, name: "قوری چینی زرین آلیس", slug: "alice-teapot", primary_image: null },
        variant: null,
        price_info: { price: 340000 },
      },
    ],
  },
  bob: {
    item_count: 1,
    subtotal: 290000,
    items: [
      {
        id: 502,
        quantity: 1,
        available_stock: 4,
        is_available: true,
        line_total: 290000,
        product: { id: 12, name: "لیوان کریستال باب", slug: "bob-glass", primary_image: null },
        variant: null,
        price_info: { price: 290000 },
      },
    ],
  },
};

const PAYMENTS = {
  "101": {
    id: 101,
    order_id: 77,
    order_number: "CG-1001",
    status: "success",
    amount: 725000,
    gateway_ref_id: "REF-SUCCESS-77",
    paid_at: "2026-10-22T09:00:00Z",
    estimated_delivery_min: 2,
    estimated_delivery_max: 4,
    shipping_method: "standard",
  },
  "102": {
    id: 102,
    order_id: 78,
    order_number: "CG-1002",
    status: "failed",
    amount: 725000,
    gateway_ref_id: "",
    failure_reason: "cancelled_or_failed_at_gateway",
  },
  "103": {
    id: 103,
    order_id: 79,
    order_number: "CG-1003",
    status: "cancelled",
    amount: 725000,
    gateway_ref_id: "",
    failure_reason: "cancelled_by_customer",
  },
  "104": {
    id: 104,
    order_id: 80,
    order_number: "CG-1004",
    status: "pending",
    amount: 725000,
    gateway_ref_id: "",
  },
};

const freePort = () =>
  new Promise((resolve) => {
    const probe = http.createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const get = (path, cookie) =>
  new Promise((resolve, reject) => {
    http
      .get(origin + path, { headers: cookie ? { Cookie: cookie } : {} }, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      })
      .on("error", reject);
  });

const stripScripts = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");

beforeAll(async () => {
  django = http.createServer((req, res) => {
    calls.push({ url: req.url, method: req.method, cookie: req.headers.cookie, host: req.headers.host });
    if (down) {
      req.socket.destroy();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    const session = /sessionid=(\w+)/.exec(req.headers.cookie || "")?.[1];

    if (req.url === "/api/v1/accounts/me/") {
      res.end(JSON.stringify(USERS[session] || { user: null }));
      return;
    }
    if (req.url === "/api/v1/cart/") {
      if (!USERS[session]) {
        res.statusCode = 401;
        res.end(JSON.stringify({ detail: "احراز هویت الزامی است." }));
        return;
      }
      res.end(JSON.stringify(CARTS[session]));
      return;
    }
    const paymentMatch = /^\/api\/v1\/payments\/(\d+)\/$/.exec(req.url);
    if (paymentMatch) {
      const payment = PAYMENTS[paymentMatch[1]];
      if (!payment) {
        res.statusCode = 404;
        res.end(JSON.stringify({ detail: "یافت نشد." }));
        return;
      }
      res.end(JSON.stringify(payment));
      return;
    }
    res.end(
      JSON.stringify(
        req.url.includes("/settings/")
          ? { pickup_address: "تهران، خیابان ولیعصر، پلاک ۱۲", pickup_hours: "۱۰ تا ۱۹" }
          : req.url.includes("/content/")
            ? {}
            : { results: [] }
      )
    );
  });

  await new Promise((resolve) => django.listen(0, "127.0.0.1", resolve));
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  nextProc = spawn("./node_modules/.bin/next", ["start", "-p", String(port), "-H", "127.0.0.1"], {
    env: { ...process.env, INTERNAL_API_URL: `http://127.0.0.1:${django.address().port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });

  for (let i = 0; i < 120; i++) {
    try {
      await get("/login/");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
}, 45000);

beforeEach(() => {
  calls = [];
  down = false;
});

afterAll(async () => {
  nextProc?.kill("SIGTERM");
  await new Promise((resolve) => (nextProc ? nextProc.once("exit", resolve) : resolve()));
  django?.closeAllConnections?.();
  await new Promise((resolve) => (django ? django.close(resolve) : resolve()));
});

it("redirects anonymous GET /checkout/?step=delivery with 307 to /login/?next=%2Fcheckout%2F%3Fstep%3Ddelivery", async () => {
  const response = await get("/checkout/?step=delivery");
  expect(response.status).toBe(307);
  expect(response.headers.location).toBe("/login/?next=%2Fcheckout%2F%3Fstep%3Ddelivery");
  expect(response.headers["cache-control"]).toContain("private");
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.headers["x-robots-tag"]).toContain("noindex");
});

it("redirects unslashed /cart, /checkout, and /payment/result URLs with 308 to canonical trailing slashes", async () => {
  for (const [raw, canonical] of [
    ["/cart", "/cart/"],
    ["/checkout", "/checkout/"],
    ["/payment/result", "/payment/result/"],
    ["/payment/result/101", "/payment/result/101/"],
  ]) {
    const res = await get(raw);
    expect(res.status).toBe(308);
    expect(res.headers.location).toBe(canonical);
  }
});

it("fails open without server redirect on /checkout/?step=delivery when Django is unreachable", async () => {
  down = true;
  const response = await get("/checkout/?step=delivery", "sessionid=alice");
  expect(response.status).toBe(200);
  expect(response.headers.location).toBeUndefined();
  expect(stripScripts(response.body)).toContain("در حال بررسی ورود…");
});

it.each([
  "/cart/",
  "/checkout/?step=delivery",
  "/payment/result/",
  "/payment/result/101/",
  "/payment/result/102/",
  "/payment/result/103/",
  "/payment/result/104/",
])("%s emits Cache-Control private, no-store and robots noindex", async (path) => {
  const response = await get(path, "sessionid=alice");
  expect(response.status).toBe(200);
  expect(response.headers["cache-control"]).toContain("private");
  expect(response.headers["cache-control"]).toContain("no-store");
  expect(response.headers["x-robots-tag"]).toBe("noindex, follow");
  expect(response.body).toContain('<meta name="robots" content="noindex, follow"/>');
});

it("renders each logged-in user's server cart without caching private data across session cookies", async () => {
  const aliceRes = await get("/cart/", "sessionid=alice; csrftoken=csrf1");
  const bobRes = await get("/cart/", "sessionid=bob; csrftoken=csrf2");
  const guestRes = await get("/cart/");

  expect(aliceRes.status).toBe(200);
  expect(bobRes.status).toBe(200);
  expect(guestRes.status).toBe(200);

  const aliceDoc = stripScripts(aliceRes.body);
  const bobDoc = stripScripts(bobRes.body);
  const guestDoc = stripScripts(guestRes.body);

  expect(aliceDoc).toContain("قوری چینی زرین آلیس");
  expect(aliceDoc).toContain(formatPrice(680000));
  expect(aliceDoc).not.toContain("لیوان کریستال باب");

  expect(bobDoc).toContain("لیوان کریستال باب");
  expect(bobDoc).toContain(formatPrice(290000));
  expect(bobDoc).not.toContain("قوری چینی زرین آلیس");

  expect(guestDoc).toContain("سبد خرید شما خالی است.");
  expect(guestDoc).not.toContain("قوری چینی زرین آلیس");
  expect(guestDoc).not.toContain("لیوان کریستال باب");

  // Both private calls reached Django directly with their respective Cookie + public Host.
  const cartCalls = calls.filter((c) => c.url === "/api/v1/cart/");
  expect(cartCalls.map((c) => c.cookie)).toEqual([
    "sessionid=alice; csrftoken=csrf1",
    "sessionid=bob; csrftoken=csrf2",
  ]);
  for (const call of cartCalls) {
    expect(call.host).toBe(new URL(origin).host);
  }
});

it("renders success, failed, cancelled, and pending payment outcomes over HTTP with exact Persian copy", async () => {
  const [okRes, failedAuth, failedAnon, cancelledAuth, pendingAuth, missingCallback] = await Promise.all([
    get("/payment/result/101/", "sessionid=alice"),
    get("/payment/result/102/", "sessionid=alice"),
    get("/payment/result/102/"),
    get("/payment/result/103/", "sessionid=alice"),
    get("/payment/result/104/", "sessionid=alice"),
    get("/payment/result/?status=cancelled", "sessionid=alice"),
  ]);

  // Both result routes carry the SPA's exact document title (hamza above ه).
  const okDoc = stripScripts(okRes.body);
  expect(okDoc).toContain("<title>نتیجهٔ پرداخت | کازین گالری</title>");
  expect(okDoc).toContain("پرداخت با موفقیت انجام شد");
  expect(okDoc).toContain("REF-SUCCESS-77");
  expect(okDoc).toContain('href="/account/orders/77/"');
  expect(okDoc).toContain('href="/shop/"');
  expect(okDoc).not.toContain("تلاش دوباره برای پرداخت");

  const failedDoc = stripScripts(failedAuth.body);
  expect(failedDoc).toContain("پرداخت ناموفق بود");
  expect(failedDoc).toContain("تراکنش در درگاه پرداخت ناموفق بود یا لغو شد");
  expect(failedDoc).toContain("تلاش دوباره برای پرداخت");
  expect(failedDoc).toContain('href="/account/orders/78/"');
  expect(failedDoc).toContain('href="/cart/"');

  // Anonymous viewer on a failed payment is not offered authenticated payment retry.
  expect(stripScripts(failedAnon.body)).not.toContain("تلاش دوباره برای پرداخت");

  const cancelledDoc = stripScripts(cancelledAuth.body);
  expect(cancelledDoc).toContain("پرداخت لغو شد");
  expect(cancelledDoc).toContain("انصراف مشتری در درگاه پرداخت");
  expect(cancelledDoc).toContain("تلاش دوباره برای پرداخت");

  // Pending offers re-check ("بررسی مجدد نتیجه") and NEVER retry ("تلاش دوباره برای پرداخت").
  const pendingDoc = stripScripts(pendingAuth.body);
  expect(pendingDoc).toContain("بررسی نتیجه پرداخت در جریان است");
  expect(pendingDoc).toContain("بررسی مجدد نتیجه");
  expect(pendingDoc).not.toContain("تلاش دوباره برای پرداخت");

  const fallbackDoc = stripScripts(missingCallback.body);
  expect(fallbackDoc).toContain("<title>نتیجهٔ پرداخت | کازین گالری</title>");
  expect(fallbackDoc).toContain("پرداخت لغو شد");
  expect(fallbackDoc).toContain("مشاهده سفارش‌ها و تلاش دوباره");
});
