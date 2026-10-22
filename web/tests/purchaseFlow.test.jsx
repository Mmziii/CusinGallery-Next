// @vitest-environment jsdom
import http from "node:http";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * End-to-end purchase flow suite in web/ using a REAL node:http fake Django
 * server (zero mocked service functions; every Axios call travels over real
 * HTTP with real CSRF headers, real JSON bodies, and real HTTP status codes).
 */
const navState = vi.hoisted(() => ({
  pathname: "/checkout/",
  search: "",
  params: {},
  history: ["/checkout/"],
  index: 0,
  calls: [],
  routerPush: vi.fn(),
  routerReplace: vi.fn(),
  listeners: new Set(),
  reset(initialUrl = "/checkout/") {
    const parsed = new URL(initialUrl, "http://cusin.local");
    this.pathname = parsed.pathname;
    this.search = parsed.search;
    this.history = [`${parsed.pathname}${parsed.search}`];
    this.index = 0;
    this.calls = [];
    this.routerPush.mockReset();
    this.routerReplace.mockReset();
    this.routerPush.mockImplementation((href) =>
      new Promise((resolve) => {
        setTimeout(() => {
          this.applyUrl(href, "push");
          resolve();
        }, 35);
      })
    );
    this.routerReplace.mockImplementation((href) =>
      new Promise((resolve) => {
        setTimeout(() => {
          this.applyUrl(href, "replace");
          resolve();
        }, 35);
      })
    );
  },
  applyUrl(href, mode) {
    const parsed = new URL(href, "http://cusin.local");
    const full = `${parsed.pathname}${parsed.search}`;
    this.calls.push({ href: full, replace: mode === "replace" });
    if (mode === "replace") {
      this.history[this.index] = full;
    } else {
      this.history = this.history.slice(0, this.index + 1);
      this.history.push(full);
      this.index = this.history.length - 1;
    }
    this.pathname = parsed.pathname;
    this.search = parsed.search;
    this.listeners.forEach((fn) => fn());
  },
  go(delta) {
    const target = this.index + delta;
    if (target < 0 || target >= this.history.length) return;
    this.index = target;
    const parsed = new URL(this.history[target], "http://cusin.local");
    this.pathname = parsed.pathname;
    this.search = parsed.search;
    if (typeof window !== "undefined") {
      window.dispatchEvent(new PopStateEvent("popstate"));
    }
    this.listeners.forEach((fn) => fn());
  },
}));

vi.mock("next/navigation", () => ({
  usePathname: () => {
    const [, bump] = React.useState(0);
    React.useEffect(() => {
      const fn = () => bump((n) => n + 1);
      navState.listeners.add(fn);
      return () => navState.listeners.delete(fn);
    }, []);
    return navState.pathname;
  },
  useSearchParams: () => {
    const [, bump] = React.useState(0);
    React.useEffect(() => {
      const fn = () => bump((n) => n + 1);
      navState.listeners.add(fn);
      return () => navState.listeners.delete(fn);
    }, []);
    return new URLSearchParams(navState.search);
  },
  useParams: () => navState.params,
  useRouter: () => ({
    push: (href) => navState.routerPush(href),
    replace: (href) => navState.routerReplace(href),
    back: () => navState.go(-1),
    refresh: () => {},
  }),
}));

vi.mock("next/link", () => ({
  default: ({ href, replace, prefetch, onClick, children, ...rest }) => (
    <a
      href={href}
      {...rest}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) {
          e.preventDefault();
          if (replace) navState.routerReplace(href);
          else navState.routerPush(href);
        }
      }}
    >
      {children}
    </a>
  ),
}));

import apiClient from "../services/apiClient";
import useAuthStore from "../store/useAuthStore";
import useCartStore from "../store/useCartStore";
import { SiteProvider } from "../lib/site-context";
import MainLayout from "../layouts/MainLayout";
import CartPage from "../purchase/CartPage";
import CheckoutPage from "../purchase/CheckoutPage";
import PaymentResultPage from "../purchase/PaymentResultPage";
import { flushEvents, resetTrackingForTests } from "../utils/behaviour";
import { formatPrice } from "../utils/formatPrice";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USER = { id: 21, phone: "09121112233", first_name: "سارا", last_name: "احمدی" };
const TEHRAN_ADDRESS = {
  id: 1,
  recipient_name: "سارا احمدی",
  phone: "09121112233",
  province: "تهران",
  city: "تهران",
  address: "خیابان ولیعصر، کوچه بهار",
  postal_code: "1234567890",
  building_number: "12",
  unit: "4",
  is_default: true,
};
const KARAJ_ADDRESS = {
  id: 2,
  recipient_name: "رضا کریمی",
  phone: "09123334455",
  province: "البرز",
  city: "کرج",
  address: "بلوار طالقانی",
  postal_code: "3145678901",
  building_number: "8",
  unit: "1",
  is_default: false,
};

let django;
let apiBase;
let db;
let requests;
const originalBaseURL = apiClient.defaults.baseURL;
const originalAdapter = apiClient.defaults.adapter;

function makeDefaultDb() {
  return {
    authenticated: true,
    settings: {
      pickup_address: "تهران، خیابان شوش، پاساژ بلور، طبقه اول، پلاک ۱۴",
      pickup_hours: "شنبه تا پنج‌شنبه ۱۰ تا ۱۹",
    },
    shipping: {
      default: "standard",
      gift_wrap_fee: 0,
      methods: [
        {
          id: "standard",
          label: "ارسال عادی",
          cost: 45000,
          free_threshold: 1000000,
          min_days: 3,
          max_days: 5,
          requires_address: true,
        },
        {
          id: "express",
          label: "ارسال اکسپرس",
          cost: 95000,
          free_threshold: null,
          min_days: 1,
          max_days: 1,
          requires_address: true,
        },
        {
          id: "pickup",
          label: "دریافت حضوری",
          cost: 0,
          free_threshold: null,
          min_days: 1,
          max_days: 1,
          requires_address: false,
          description: "شنبه تا پنج‌شنبه ۱۰ تا ۱۹",
        },
      ],
    },
    addresses: [{ ...TEHRAN_ADDRESS }],
    cartItems: [
      {
        id: 301,
        quantity: 2,
        available_stock: 5,
        is_available: true,
        line_total: 600000,
        product: { id: 10, name: "سرویس قابلمه گرانیتی", slug: "granite-pot-set", primary_image: null },
        variant: null,
        price_info: { price: 300000 },
      },
    ],
    catalogProducts: [
      {
        id: 10,
        name: "سرویس قابلمه گرانیتی",
        slug: "granite-pot-set",
        stock_quantity: 5,
        primary_image: null,
        price_info: { price: 300000 },
        variants: [
          {
            id: 55,
            sku: "GP-RED",
            stock_quantity: 3,
            price_info: { price: 325000 },
            attribute_values: [{ attribute: "رنگ", value: "زرشکی" }],
          },
        ],
      },
    ],
    coupons: {
      SAVE20: { type: "percent", value: 20 },
      FLAT50: { type: "fixed", value: 50000 },
    },
    orders: [],
    payments: {},
    events: [],
    checkoutDelayMs: 0,
    nextCheckoutError: null,
    nextInitiateError: null,
    mergeResponse: null,
  };
}

function buildCartPayload() {
  const subtotal = db.cartItems.reduce((sum, item) => sum + item.line_total, 0);
  const item_count = db.cartItems.reduce((sum, item) => sum + item.quantity, 0);
  return { item_count, subtotal, items: db.cartItems.map((i) => ({ ...i })) };
}

/** Exact mirror of backend/apps/orders/services.py monetary calculation. */
function computeServerTotals({ subtotal, methodId, couponCode, giftWrap }) {
  const method = db.shipping.methods.find((m) => m.id === methodId);
  const shipping_cost =
    method.free_threshold != null && subtotal >= method.free_threshold ? 0 : method.cost;
  let discount_amount = 0;
  if (couponCode && db.coupons[couponCode]) {
    const rule = db.coupons[couponCode];
    discount_amount =
      rule.type === "percent" ? Math.floor((subtotal * rule.value) / 100) : Math.min(subtotal, rule.value);
  }
  const gift_wrap = Boolean(giftWrap) && db.shipping.gift_wrap_fee > 0;
  const gift_wrap_fee = gift_wrap ? db.shipping.gift_wrap_fee : 0;
  const total = subtotal + shipping_cost + gift_wrap_fee - discount_amount;
  return { subtotal, shipping_cost, gift_wrap, gift_wrap_fee, discount_amount, total };
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

beforeAll(async () => {
  db = makeDefaultDb();
  requests = [];

  django = http.createServer(async (req, res) => {
    const body = await readJson(req);
    const parsed = new URL(req.url, "http://internal");
    const path = parsed.pathname;
    const method = req.method.toUpperCase();
    requests.push({ method, path, query: parsed.search, headers: { ...req.headers }, body });

    // Enforce CSRF token header on unsafe state-changing requests just like Django CSRF middleware
    // (only /api/v1/analytics/events/ is @csrf_exempt in backend/apps/analytics/views.py).
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && path !== "/api/v1/analytics/events/") {
      if (req.headers["x-csrftoken"] !== "test-csrf-token") {
        return sendJson(res, 403, { detail: "CSRF verification failed." });
      }
    }

    if (path === "/api/v1/accounts/csrf/") return sendJson(res, 200, { csrfToken: "test-csrf-token" });
    if (path === "/api/v1/accounts/login/" && method === "POST") {
      db.authenticated = true;
      return sendJson(res, 200, USER);
    }
    if (path === "/api/v1/accounts/me/") {
      return db.authenticated
        ? sendJson(res, 200, USER)
        : sendJson(res, 401, { detail: "اطلاعات اعتبارسنجی ارسال نشده است." });
    }
    if (path === "/api/v1/accounts/locations/") return sendJson(res, 200, { provinces: [] });
    if (path === "/api/v1/site/settings/") return sendJson(res, 200, db.settings);
    if (path === "/api/v1/categories/tree/") return sendJson(res, 200, []);

    if (path === "/api/v1/accounts/addresses/" && method === "GET") {
      return sendJson(res, 200, { count: db.addresses.length, next: null, previous: null, results: db.addresses });
    }
    if (path === "/api/v1/accounts/addresses/" && method === "POST") {
      const created = { id: db.addresses.length + 10, ...body };
      db.addresses.push(created);
      return sendJson(res, 201, created);
    }

    if (path === "/api/v1/cart/" && method === "GET") {
      return sendJson(res, 200, buildCartPayload());
    }
    const cartItemMatch = /^\/api\/v1\/cart\/items\/(\d+)\/$/.exec(path);
    if (cartItemMatch && method === "PATCH") {
      const id = Number(cartItemMatch[1]);
      if (body.quantity <= 0) {
        db.cartItems = db.cartItems.filter((item) => item.id !== id);
      } else {
        db.cartItems = db.cartItems.map((item) =>
          item.id === id
            ? { ...item, quantity: body.quantity, line_total: item.price_info.price * body.quantity }
            : item
        );
      }
      return sendJson(res, 200, buildCartPayload());
    }
    if (cartItemMatch && method === "DELETE") {
      const id = Number(cartItemMatch[1]);
      db.cartItems = db.cartItems.filter((item) => item.id !== id);
      return sendJson(res, 200, buildCartPayload());
    }
    if (path === "/api/v1/cart/merge/" && method === "POST") {
      if (db.mergeResponse) {
        db.cartItems = db.mergeResponse.cart.items;
        return sendJson(res, 200, db.mergeResponse);
      }
      return sendJson(res, 200, { cart: buildCartPayload(), adjusted: [], skipped: [] });
    }

    if (path === "/api/v1/products/" && method === "GET") {
      return sendJson(res, 200, { results: db.catalogProducts });
    }
    const productSlugMatch = /^\/api\/v1\/products\/([^/]+)\/$/.exec(path);
    if (productSlugMatch && method === "GET") {
      const found = db.catalogProducts.find((p) => p.slug === decodeURIComponent(productSlugMatch[1]));
      return found ? sendJson(res, 200, found) : sendJson(res, 404, { detail: "یافت نشد." });
    }

    if (path === "/api/v1/orders/shipping-methods/" && method === "GET") {
      return sendJson(res, 200, db.shipping);
    }

    if (path === "/api/v1/discounts/coupons/validate/" && method === "POST") {
      const code = String(body.code || "").trim().toUpperCase();
      const rule = db.coupons[code];
      if (!rule) return sendJson(res, 400, { detail: "کد تخفیف معتبر نیست." });
      const subtotal = buildCartPayload().subtotal;
      const discount_amount =
        rule.type === "percent" ? Math.floor((subtotal * rule.value) / 100) : Math.min(subtotal, rule.value);
      return sendJson(res, 200, { code, discount_amount });
    }

    if (path === "/api/v1/orders/checkout/" && method === "POST") {
      if (db.checkoutDelayMs > 0) {
        await new Promise((r) => setTimeout(r, db.checkoutDelayMs));
      }
      if (db.nextCheckoutError) {
        const { status, payload } = db.nextCheckoutError;
        db.nextCheckoutError = null;
        return sendJson(res, status, payload);
      }
      const subtotal = buildCartPayload().subtotal;
      const totals = computeServerTotals({
        subtotal,
        methodId: body.shipping_method,
        couponCode: body.coupon_code,
        giftWrap: body.gift_wrap,
      });
      const order = {
        id: 900 + db.orders.length + 1,
        order_number: `CG-90${db.orders.length + 1}`,
        shipping_method: body.shipping_method,
        coupon_code: body.coupon_code || "",
        gift_message: body.gift_wrap ? String(body.gift_message || "").slice(0, 200) : "",
        ...totals,
      };
      db.orders.push(order);
      db.cartItems = [];
      return sendJson(res, 201, order);
    }

    if (path === "/api/v1/payments/initiate/" && method === "POST") {
      if (db.nextInitiateError) {
        const { status, payload } = db.nextInitiateError;
        db.nextInitiateError = null;
        return sendJson(res, status, payload);
      }
      const orderId = body.order_id;
      return sendJson(res, 201, {
        payment: { id: 700 + db.orders.length, order_id: orderId, status: "pending" },
        redirect_url: `https://gateway.shaparak.test/start/${orderId}`,
      });
    }

    const paymentMatch = /^\/api\/v1\/payments\/(\d+)\/$/.exec(path);
    if (paymentMatch && method === "GET") {
      const payment = db.payments[paymentMatch[1]];
      return payment ? sendJson(res, 200, payment) : sendJson(res, 404, { detail: "یافت نشد." });
    }

    if (path === "/api/v1/analytics/events/" && method === "POST") {
      db.events.push(...(body.events || []));
      return sendJson(res, 201, { saved: (body.events || []).length });
    }

    return sendJson(res, 200, { results: [] });
  });

  await new Promise((resolve) => django.listen(0, "127.0.0.1", resolve));
  apiBase = `http://127.0.0.1:${django.address().port}/api/v1`;
});

afterAll(async () => {
  apiClient.defaults.baseURL = originalBaseURL;
  apiClient.defaults.adapter = originalAdapter;
  django.closeAllConnections?.();
  await new Promise((resolve) => django.close(resolve));
});

let root;
let container;
let redirectedUrls;
let historyPushSpy;
let historyReplaceSpy;

function mount(element, url = "/checkout/?step=delivery") {
  navState.reset(url);
  historyPushSpy?.mockClear();
  historyReplaceSpy?.mockClear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<SiteProvider value={{ settings: db.settings, content: {} }}>{element}</SiteProvider>);
  });
}

function rerender(element) {
  act(() => {
    root.render(<SiteProvider value={{ settings: db.settings, content: {} }}>{element}</SiteProvider>);
  });
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 15));
  });
}

async function waitUntil(assertion, timeout = 3000) {
  const deadline = Date.now() + timeout;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      return assertion();
    } catch (err) {
      lastErr = err;
      await flush();
    }
  }
  throw lastErr;
}

function click(el) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function setInput(el, value) {
  act(() => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function toggleCheckbox(el) {
  act(() => {
    el.click();
  });
}

beforeEach(() => {
  db = makeDefaultDb();
  requests = [];
  redirectedUrls = [];
  localStorage.clear();
  sessionStorage.clear();
  resetTrackingForTests();
  document.cookie = "csrftoken=test-csrf-token";
  window.scrollTo = vi.fn();

  apiClient.defaults.baseURL = apiBase;
  apiClient.defaults.adapter = "http";

  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if (typeof input === "string" && input.startsWith("/")) {
      return realFetch(`http://127.0.0.1:${django.address().port}${input}`, init);
    }
    return realFetch(input, init);
  });

  historyPushSpy = vi.spyOn(window.history, "pushState").mockImplementation((_state, _unused, url) => {
    navState.applyUrl(String(url), "push");
  });
  historyReplaceSpy = vi.spyOn(window.history, "replaceState").mockImplementation((_state, _unused, url) => {
    navState.applyUrl(String(url), "replace");
  });
  vi.spyOn(window.history, "go").mockImplementation((delta) => navState.go(delta));
  vi.spyOn(window.history, "back").mockImplementation(() => navState.go(-1));
  vi.spyOn(window.history, "forward").mockImplementation(() => navState.go(1));

  vi.stubGlobal(
    "location",
    Object.assign(new URL("http://cusin.local/checkout/?step=delivery"), {
      assign: (url) => redirectedUrls.push(url),
      replace: (url) => redirectedUrls.push(url),
    })
  );

  useAuthStore.setState({ user: USER, isAuthenticated: true, isLoading: false, error: null, sessionExpired: false });
  useCartStore.setState({
    cart: null,
    isLoading: false,
    error: null,
    guestLines: [],
    guestProducts: {},
    guestVariants: {},
    guestHydration: "idle",
    guestHydrationError: null,
    lastMergeReport: null,
  });
});

afterEach(() => {
  if (root) act(() => root.unmount());
  root = null;
  container?.remove();
  navState.params = {};
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("checkout step contract, guards, back/forward, and analytics", () => {
  it("replaces missing or invalid ?step with ?step=delivery via History API once without calling router.push/replace", async () => {
    mount(<CheckoutPage />, "/checkout/");

    // Synchronous History API normalization: updates URL immediately without RSC round-trip.
    expect(navState.search).toBe("?step=delivery");
    expect(historyReplaceSpy).toHaveBeenCalledTimes(1);
    expect(historyReplaceSpy).toHaveBeenLastCalledWith(null, "", "/checkout/?step=delivery");
    expect(historyPushSpy).not.toHaveBeenCalled();

    // Wait for async shipping/address/cart updates + force multiple extra re-renders:
    // normalization MUST still have written history only ONCE and NEVER called router.push/replace.
    await waitUntil(() => expect(container.textContent).toContain("ارسال عادی"));
    expect(container.textContent).toContain("۲. انتخاب روش تحویل");
    rerender(<CheckoutPage />);
    rerender(<CheckoutPage />);
    rerender(<CheckoutPage />);

    expect(historyReplaceSpy).toHaveBeenCalledTimes(1);
    expect(historyPushSpy).not.toHaveBeenCalled();
    expect(navState.routerPush).not.toHaveBeenCalled();
    expect(navState.routerReplace).not.toHaveBeenCalled();

    act(() => root.unmount());
    container.remove();

    mount(<CheckoutPage />, "/checkout/?step=invalid");
    await waitUntil(() => expect(container.textContent).toContain("ارسال عادی"));
    rerender(<CheckoutPage />);
    rerender(<CheckoutPage />);

    expect(navState.search).toBe("?step=delivery");
    expect(historyReplaceSpy).toHaveBeenCalledTimes(1);
    expect(historyReplaceSpy).toHaveBeenLastCalledWith(null, "", "/checkout/?step=delivery");
    expect(historyPushSpy).not.toHaveBeenCalled();
    expect(navState.routerPush).not.toHaveBeenCalled();
    expect(navState.routerReplace).not.toHaveBeenCalled();
  });

  it("guards ?step=review back to ?step=address when no valid address exists, and supports back/forward per step without router round-trips", async () => {
    db.addresses = [];
    mount(<CheckoutPage />, "/checkout/?step=review");

    await waitUntil(() => {
      expect(navState.search).toBe("?step=address");
      expect(container.textContent).toContain("۳. اطلاعات تحویل");
    });
    // Guard must replace history once rather than push, never call router.push/replace, and never expose order placement early.
    expect(historyReplaceSpy).toHaveBeenCalledTimes(1);
    expect(historyReplaceSpy).toHaveBeenLastCalledWith(null, "", "/checkout/?step=address");
    expect(navState.routerPush).not.toHaveBeenCalled();
    expect(navState.routerReplace).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("ثبت سفارش و پرداخت");

    // Now test full forward & browser back/forward navigation across steps with a saved address.
    act(() => root.unmount());
    container.remove();
    db.addresses = [{ ...TEHRAN_ADDRESS }];

    mount(<CheckoutPage />, "/checkout/?step=delivery");
    await waitUntil(() => expect(container.textContent).toContain("ارسال عادی"));

    click([...container.querySelectorAll("button")].find((b) => b.textContent.includes("ادامه: اطلاعات تحویل")));
    expect(navState.search).toBe("?step=address");
    expect(container.textContent).toContain("۳. اطلاعات تحویل");

    click([...container.querySelectorAll("button")].find((b) => b.textContent.includes("ادامه: بازبینی و پرداخت")));
    expect(navState.search).toBe("?step=review");
    expect(container.textContent).toContain("۴. بازبینی و پرداخت");

    expect(historyPushSpy).toHaveBeenCalledTimes(2);
    expect(historyReplaceSpy).not.toHaveBeenCalled();
    expect(navState.routerPush).not.toHaveBeenCalled();
    expect(navState.routerReplace).not.toHaveBeenCalled();

    // Browser Back: review -> address -> delivery; Browser Forward: delivery -> address -> review
    act(() => window.history.back());
    expect(container.textContent).toContain("۳. اطلاعات تحویل");
    act(() => window.history.back());
    expect(container.textContent).toContain("۲. انتخاب روش تحویل");
    act(() => window.history.forward());
    expect(container.textContent).toContain("۳. اطلاعات تحویل");
    act(() => window.history.forward());
    expect(container.textContent).toContain("۴. بازبینی و پرداخت");

    expect(navState.routerPush).not.toHaveBeenCalled();
    expect(navState.routerReplace).not.toHaveBeenCalled();

    flushEvents();
    await waitUntil(() => {
      expect(db.events.filter((e) => e.type === "checkout_started")).toHaveLength(1);
    });
  });
});

describe("order placement, double-click guard, gateway redirect, Persian errors, and idempotent payment retry", () => {
  it("sends exactly ONE checkout request on rapid double-click and redirects browser to redirect_url", async () => {
    db.checkoutDelayMs = 80;
    mount(<CheckoutPage />, "/checkout/?step=review");

    await waitUntil(() => expect(container.textContent).toContain("۴. بازبینی و پرداخت"));
    const submitBtn = container.querySelector(".checkout__desktop-action");
    expect(submitBtn.textContent).toContain("ثبت سفارش و پرداخت");

    // Fire two rapid synchronous clicks before the in-flight request resolves.
    act(() => {
      submitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      submitBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    await waitUntil(() => {
      expect(redirectedUrls).toEqual(["https://gateway.shaparak.test/start/901"]);
    });

    const checkoutPosts = requests.filter((r) => r.method === "POST" && r.path === "/api/v1/orders/checkout/");
    const initiatePosts = requests.filter((r) => r.method === "POST" && r.path === "/api/v1/payments/initiate/");
    expect(checkoutPosts).toHaveLength(1);
    expect(checkoutPosts[0].headers["x-csrftoken"]).toBe("test-csrf-token");
    expect(checkoutPosts[0].body).toEqual({ address_id: 1, shipping_method: "standard" });
    expect(initiatePosts).toHaveLength(1);
  });

  it("shows the Persian error when checkout fails, and when payment initiation fails never places a second order on retry", async () => {
    db.nextCheckoutError = {
      status: 400,
      payload: { detail: "موجودی یکی از کالاهای سبد خرید به پایان رسیده است." },
    };
    mount(<CheckoutPage />, "/checkout/?step=review");
    await waitUntil(() => expect(container.textContent).toContain("۴. بازبینی و پرداخت"));

    click(container.querySelector(".checkout__desktop-action"));
    await waitUntil(() => {
      expect(container.textContent).toContain("موجودی یکی از کالاهای سبد خرید به پایان رسیده است.");
    });
    expect(db.orders).toHaveLength(0);

    // Next attempt: order succeeds, gateway initiate fails -> shows placedOrder screen; retry calls initiate ONLY!
    db.nextInitiateError = {
      status: 400,
      payload: { detail: "ارتباط با درگاه پرداخت برقرار نشد. دوباره تلاش کنید." },
    };
    click(container.querySelector(".checkout__desktop-action"));

    await waitUntil(() => {
      expect(container.textContent).toContain("سفارش شما ثبت شد");
      expect(container.textContent).toContain("ارتباط با درگاه پرداخت برقرار نشد. دوباره تلاش کنید.");
    });
    expect(db.orders).toHaveLength(1);

    const retryPayBtn = [...container.querySelectorAll("button")].find((b) =>
      b.textContent.includes("پرداخت آنلاین")
    );
    click(retryPayBtn);

    await waitUntil(() => {
      expect(redirectedUrls).toEqual(["https://gateway.shaparak.test/start/901"]);
    });
    // Still ONLY ONE order ever created on the server!
    expect(db.orders).toHaveLength(1);
    expect(requests.filter((r) => r.method === "POST" && r.path === "/api/v1/payments/initiate/")).toHaveLength(2);
  });
});

describe("review totals match server calculation (shipping method, free-shipping threshold, coupon, gift wrap)", () => {
  it.each([
    {
      label: "standard shipping below free threshold + coupon apply/remove + gift wrap",
      subtotal: 980000, // 980,000 + 35,000 gift wrap = 1,015,000, still below 1,000,000 product threshold!
      methodId: "standard",
      giftWrapFee: 35000,
      useGiftWrap: true,
      couponCode: "SAVE20",
    },
    {
      label: "standard shipping at/above free threshold (0 shipping) + fixed coupon",
      subtotal: 1200000,
      methodId: "standard",
      giftWrapFee: 35000,
      useGiftWrap: false,
      couponCode: "FLAT50",
    },
    {
      label: "express shipping for Tehran + gift wrap",
      subtotal: 1500000,
      methodId: "express",
      giftWrapFee: 35000,
      useGiftWrap: true,
      couponCode: "",
    },
    {
      label: "store pickup (0 shipping) + percent coupon",
      subtotal: 500000,
      methodId: "pickup",
      giftWrapFee: 0,
      useGiftWrap: false,
      couponCode: "SAVE20",
    },
  ])("matches server total exactly for $label", async ({ subtotal, methodId, giftWrapFee, useGiftWrap, couponCode }) => {
    db.cartItems = [
      {
        id: 401,
        quantity: 1,
        available_stock: 5,
        is_available: true,
        line_total: subtotal,
        product: { id: 10, name: "ست پذیرایی کریستال", slug: "crystal-set", primary_image: null },
        variant: null,
        price_info: { price: subtotal },
      },
    ];
    db.shipping.gift_wrap_fee = giftWrapFee;
    sessionStorage.setItem("cg_checkout_method", methodId);
    if (methodId === "pickup") {
      sessionStorage.setItem(
        "cg_checkout_pickup",
        JSON.stringify({ recipient_name: "سارا احمدی", phone: "09121112233" })
      );
    }

    mount(<CheckoutPage />, "/checkout/?step=review");
    await waitUntil(() => expect(container.textContent).toContain("۴. بازبینی و پرداخت"));

    if (useGiftWrap) {
      const checkbox = container.querySelector('input[type="checkbox"]');
      expect(checkbox).toBeTruthy();
      toggleCheckbox(checkbox);
      const msgInput = container.querySelector('input[placeholder="متن کارت هدیه…"]');
      setInput(msgInput, "تولدت مبارک");
    }

    if (couponCode) {
      setInput(container.querySelector("#checkout-coupon"), couponCode);
      click([...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "اعمال"));
      await waitUntil(() => expect(container.textContent).toContain(`کد «${couponCode}» اعمال شد`));

      // Verify coupon removal restores pre-coupon total cleanly, then re-apply.
      click([...container.querySelectorAll("button")].find((b) => b.textContent.includes("حذف کد تخفیف")));
      await waitUntil(() => expect(container.textContent).not.toContain(`کد «${couponCode}» اعمال شد`));

      setInput(container.querySelector("#checkout-coupon"), couponCode);
      click([...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "اعمال"));
      await waitUntil(() => expect(container.textContent).toContain(`کد «${couponCode}» اعمال شد`));
    }

    const expected = computeServerTotals({
      subtotal,
      methodId,
      couponCode: couponCode || undefined,
      giftWrap: useGiftWrap,
    });

    const desktopGrand = container.querySelector(".checkout__grand dd").textContent;
    const mobileGrand = container.querySelector(".checkout__mobile-total b").textContent;
    expect(desktopGrand).toBe(`${formatPrice(expected.total)} تومان`);
    expect(mobileGrand).toBe(`${formatPrice(expected.total)} تومان`);

    click(container.querySelector(".checkout__desktop-action"));
    await waitUntil(() => expect(db.orders).toHaveLength(1));
    expect(db.orders[0].total).toBe(expected.total);
  });
});

describe("Tehran-only express shipping and pickup store address/hours", () => {
  it("disables express for non-Tehran saved addresses and shows store pickup address & hours on pickup", async () => {
    db.addresses = [{ ...KARAJ_ADDRESS, is_default: true }, { ...TEHRAN_ADDRESS, is_default: false }];
    mount(<CheckoutPage />, "/checkout/?step=delivery");
    await waitUntil(() => expect(container.textContent).toContain("ارسال اکسپرس"));

    // Select express -> proceed to address
    const expressCard = [...container.querySelectorAll('[role="radio"]')].find((el) =>
      el.textContent.includes("ارسال اکسپرس")
    );
    click(expressCard);
    click([...container.querySelectorAll("button")].find((b) => b.textContent.includes("ادامه: اطلاعات تحویل")));
    await waitUntil(() => expect(container.textContent).toContain("۳. اطلاعات تحویل"));

    // Karaj card is disabled with Tehran warning; proceeding with Karaj selected is blocked.
    const cards = [...container.querySelectorAll(".address-card")];
    expect(cards[0].classList.contains("address-card--disabled")).toBe(true);
    expect(cards[0].textContent).toContain("ارسال اکسپرس فقط برای شهر تهران در دسترس است.");
    expect(cards[1].classList.contains("address-card--disabled")).toBe(false);

    click([...container.querySelectorAll("button")].find((b) => b.textContent.includes("ادامه: بازبینی و پرداخت")));
    expect(navState.search).toBe("?step=address");
    expect(container.textContent).toContain("ارسال اکسپرس فقط برای شهر تهران در دسترس است");

    // Selecting the Tehran address immediately allows proceeding to review!
    click(cards[1].querySelector('input[type="radio"]'));
    click([...container.querySelectorAll("button")].find((b) => b.textContent.includes("ادامه: بازبینی و پرداخت")));
    await waitUntil(() => expect(navState.search).toBe("?step=review"));

    // Switch back to delivery -> choose pickup -> verify store pickup_address and pickup_hours appear on address & review!
    click([...container.querySelectorAll("button")].find((b) => b.textContent.trim() === "تغییر"));
    await waitUntil(() => expect(navState.search).toBe("?step=delivery"));

    const pickupCard = [...container.querySelectorAll('[role="radio"]')].find((el) =>
      el.textContent.includes("دریافت حضوری")
    );
    click(pickupCard);
    click([...container.querySelectorAll("button")].find((b) => b.textContent.includes("ادامه: اطلاعات تحویل")));
    await waitUntil(() => expect(container.textContent).toContain("اطلاعات دریافت حضوری"));

    expect(container.textContent).toContain("پاساژ بلور");
    expect(container.textContent).toContain("۱۰ تا ۱۹");

    setInput(container.querySelector("#pickup-recipient_name"), "مینا رضایی");
    setInput(container.querySelector("#pickup-phone"), "09129876543");
    click([...container.querySelectorAll("button")].find((b) => b.textContent.includes("ادامه: بازبینی و پرداخت")));
    await waitUntil(() => expect(navState.search).toBe("?step=review"));
    expect(container.textContent).toContain("مینا رضایی");
    expect(container.textContent).toContain("پاساژ بلور");
  });
});

describe("cart ConfirmDialog, guest cart hydration, and post-login cart merge", () => {
  it("confirms remove and decrease-to-zero via ConfirmDialog (cancel keeps line, confirm removes, window.confirm never called)", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    db.cartItems = [
      {
        id: 301,
        quantity: 1,
        available_stock: 5,
        is_available: true,
        line_total: 300000,
        product: { id: 10, name: "سرویس قابلمه گرانیتی", slug: "granite-pot-set", primary_image: null },
        variant: null,
        price_info: { price: 300000 },
      },
    ];

    mount(<CartPage />, "/cart/");
    await waitUntil(() => expect(container.textContent).toContain("سرویس قابلمه گرانیتی"));

    // 1. Decrease-to-zero -> cancel keeps item
    click(container.querySelector('button[aria-label="کاهش تعداد"]'));
    await waitUntil(() => expect(document.body.querySelector('[role="alertdialog"]')).toBeTruthy());
    click(
      [...document.body.querySelector('[role="alertdialog"]').querySelectorAll("button")].find((b) =>
        b.textContent.includes("انصراف")
      )
    );
    await waitUntil(() => expect(document.body.querySelector('[role="alertdialog"]')).toBeNull());
    expect(container.textContent).toContain("سرویس قابلمه گرانیتی");
    expect(requests.filter((r) => ["PATCH", "DELETE"].includes(r.method))).toHaveLength(0);

    // 2. Click «حذف» -> confirm deletes item via DELETE /api/v1/cart/items/301/
    click(container.querySelector(".link-danger"));
    await waitUntil(() => expect(document.body.querySelector('[role="alertdialog"]')).toBeTruthy());
    click(
      [...document.body.querySelector('[role="alertdialog"]').querySelectorAll("button")].find((b) =>
        b.textContent.trim() === "حذف"
      )
    );
    await waitUntil(() => expect(container.textContent).toContain("سبد خرید شما خالی است."));
    expect(requests.some((r) => r.method === "DELETE" && r.path === "/api/v1/cart/items/301/")).toBe(true);
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("renders guest cart with variant pricing from server and merges guest cart on login with MergeNotice", async () => {
    const nativeConfirm = vi.spyOn(window, "confirm");
    db.authenticated = false;
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, error: null });
    act(() => {
      useCartStore.getState().addGuestItem(10, 55, 2);
    });

    db.mergeResponse = {
      cart: {
        item_count: 1,
        subtotal: 325000,
        items: [
          {
            id: 777,
            quantity: 1,
            available_stock: 1,
            is_available: true,
            line_total: 325000,
            product: { id: 10, name: "سرویس قابلمه گرانیتی", slug: "granite-pot-set", primary_image: null },
            variant: { id: 55, attribute_values: [{ attribute: "رنگ", value: "زرشکی" }] },
            price_info: { price: 325000 },
          },
        ],
      },
      report: {
        merged: 1,
        adjusted: [{ product_name: "سرویس قابلمه گرانیتی", requested: 2, available: 1 }],
        skipped: [],
      },
    };

    mount(
      <MainLayout>
        <CartPage />
      </MainLayout>,
      "/cart/"
    );

    // Guest cart hydrates product + variant price (2 * 325,000 = 650,000) from real node:http API.
    await waitUntil(() => {
      expect(container.textContent).toContain("شما به‌صورت مهمان خرید می‌کنید");
      expect(container.textContent).toContain("سرویس قابلمه گرانیتی");
      expect(container.textContent).toContain(formatPrice(650000));
    });

    // Logging in triggers POST /api/v1/cart/merge/, transitions CartPage to server cart, and displays MergeNotice!
    await act(async () => {
      await useAuthStore.getState().login("09121112233", "Password123!");
    });

    await waitUntil(() => {
      expect(requests.some((r) => r.method === "POST" && r.path === "/api/v1/cart/merge/")).toBe(true);
      expect(container.textContent).toContain("ادامه و ثبت سفارش");
      expect(container.textContent).toContain("سبد مهمان شما به حساب منتقل شد؛ تعداد برخی اقلام به‌دلیل موجودی محدود شد.");
    });
    expect(useCartStore.getState().guestLines).toEqual([]);
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it("seeds and renders a fresh serverCart over an older non-guest store cart without overwriting a guest cart", async () => {
    const staleStoreCart = {
      item_count: 1,
      subtotal: 300000,
      items: [
        {
          id: 101,
          quantity: 1,
          available_stock: 5,
          is_available: true,
          line_total: 300000,
          product: { id: 10, name: "قابلمه قدیمی", slug: "old-pot", primary_image: null },
          variant: null,
          price_info: { price: 300000 },
        },
      ],
    };
    const freshServerCart = {
      item_count: 2,
      subtotal: 950000,
      items: [
        {
          id: 202,
          quantity: 2,
          available_stock: 4,
          is_available: true,
          line_total: 950000,
          product: { id: 22, name: "سرویس کارد جدید", slug: "new-knife-set", primary_image: null },
          variant: null,
          price_info: { price: 475000 },
        },
      ],
    };

    // Store already holds an older non-guest cart from earlier client navigation.
    useCartStore.setState({ cart: staleStoreCart, isLoading: false, error: null });

    mount(<CartPage serverCart={freshServerCart} />, "/cart/");

    // Fresh serverCart immediately wins both in rendered DOM AND in Zustand store, with no extra GET /cart/.
    expect(container.textContent).toContain("سرویس کارد جدید");
    expect(container.textContent).toContain(formatPrice(950000));
    expect(container.textContent).not.toContain("قابلمه قدیمی");
    expect(useCartStore.getState().cart).toEqual(freshServerCart);
    expect(requests.filter((r) => r.path === "/api/v1/cart/")).toHaveLength(0);

    // Conversely, a pending guest cart in the store must NEVER be overwritten by serverCart.
    act(() => root.unmount());
    container.remove();
    act(() => {
      useCartStore.getState().addGuestItem(10, 55, 2);
    });
    const pendingGuestCart = useCartStore.getState().cart;
    expect(pendingGuestCart.guest).toBe(true);

    mount(<CartPage serverCart={freshServerCart} />, "/cart/");
    expect(useCartStore.getState().cart).toBe(pendingGuestCart);
    expect(useCartStore.getState().guestLines).toEqual([{ product_id: 10, variant_id: 55, quantity: 2 }]);
  });
});

describe("payment result client re-check and retry flows", () => {
  it("re-checks a pending payment into success, and retries a failed payment to gateway redirect_url", async () => {
    db.payments["501"] = {
      id: 501,
      order_id: 950,
      order_number: "CG-950",
      status: "pending",
      amount: 645000,
      gateway_ref_id: "",
    };
    navState.params = { paymentId: "501" };

    mount(<PaymentResultPage />, "/payment/result/501/");
    await waitUntil(() => {
      expect(container.textContent).toContain("بررسی نتیجه پرداخت در جریان است");
      expect(container.textContent).toContain("بررسی مجدد نتیجه");
    });
    expect(container.textContent).not.toContain("تلاش دوباره برای پرداخت");

    // Backend finalizes the payment -> user clicks «بررسی مجدد نتیجه»
    db.payments["501"] = {
      ...db.payments["501"],
      status: "success",
      gateway_ref_id: "REF-FINAL-950",
    };
    click([...container.querySelectorAll("button")].find((b) => b.textContent.includes("بررسی مجدد نتیجه")));
    await waitUntil(() => {
      expect(container.textContent).toContain("پرداخت با موفقیت انجام شد");
      expect(container.textContent).toContain("REF-FINAL-950");
    });

    // Failed payment retry -> calls POST /api/v1/payments/initiate/ with order_id and redirects
    act(() => root.unmount());
    container.remove();
    db.payments["502"] = {
      id: 502,
      order_id: 951,
      order_number: "CG-951",
      status: "failed",
      amount: 645000,
      failure_reason: "cancelled_or_failed_at_gateway",
    };
    navState.params = { paymentId: "502" };
    mount(<PaymentResultPage />, "/payment/result/502/");
    await waitUntil(() => expect(container.textContent).toContain("پرداخت ناموفق بود"));

    click(
      [...container.querySelectorAll("button")].find((b) => b.textContent.includes("تلاش دوباره برای پرداخت"))
    );
    await waitUntil(() => {
      expect(redirectedUrls).toEqual(["https://gateway.shaparak.test/start/951"]);
    });
  });
});
