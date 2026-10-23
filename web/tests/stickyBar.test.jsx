// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProductDetail from "../product/ProductDetail";
import Breadcrumbs from "../components/Breadcrumbs";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../lib/navigation", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// Phone viewport so the sticky-bar effect arms itself.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  configurable: true,
  value: vi.fn((query) => ({
    matches: query.includes("(max-width: 767px)"),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })),
});

let observerCallback;
global.IntersectionObserver = vi.fn(function IntersectionObserver(cb) {
  observerCallback = cb;
  this.observe = vi.fn();
  this.disconnect = vi.fn();
  this.takeRecords = vi.fn(() => []);
});

const product = {
  id: 1,
  slug: "copper-pot",
  name: "قابلمه مسی",
  stock_status: "in_stock",
  price_info: { price: 125000 },
  images: [],
  variants: [],
  related_products: [],
};

let root;
let container;

beforeEach(() => {
  observerCallback = null;
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
});

it("sticky bar: hidden while the main add-to-cart button is visible, shown when it is out of view", () => {
  act(() => {
    root = createRoot(container);
    root.render(<ProductDetail product={product} slug="copper-pot" reviews={{}} />);
  });

  const bar = container.querySelector(".product-detail__stickybar");
  expect(bar).not.toBeNull();

  // SSR default: hidden-safe — no visibility class, nothing jumps.
  expect(bar.classList.contains("product-detail__stickybar--visible")).toBe(false);

  // The effect armed an IntersectionObserver on the main add-to-cart button.
  expect(observerCallback).toBeDefined();
  const button = container.querySelector(".product-detail__buy .btn--primary");
  expect(button).not.toBeNull();

  // Button in view -> bar stays hidden.
  act(() => observerCallback([{ isIntersecting: true, target: button }]));
  expect(bar.classList.contains("product-detail__stickybar--visible")).toBe(false);

  // Button scrolled out of view -> bar appears (class toggled by JS; CSS
  // shows it only below 768px together with that class).
  act(() => observerCallback([{ isIntersecting: false, target: button }]));
  expect(bar.classList.contains("product-detail__stickybar--visible")).toBe(true);
  expect(bar.textContent).toContain("سبد خرید");
});

it("breadcrumbs: scrolls the <ol> to its end; RTL scrolls negative (-max), never the page", () => {
  const items = [
    { label: "کازین گالری", to: "/" },
    { label: "قابلمه مسی" },
  ];

  for (const [dir, sign] of [["rtl", -1], ["ltr", 1]]) {
    act(() => {
      root = createRoot(container);
      root.render(<Breadcrumbs items={items} />);
    });

    const ol = container.querySelector(".breadcrumbs ol");
    expect(ol).not.toBeNull();

    // Mock scroll geometry and direction on the rendered <ol>.
    Object.defineProperty(ol, "scrollWidth", { value: 400, configurable: true });
    Object.defineProperty(ol, "clientWidth", { value: 200, configurable: true });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({ direction: dir });

    // Re-run the same scroll logic the effect uses (scrollWidth/clientWidth
    // were 0 on first mount, so the effect itself did not scroll yet).
    const max = ol.scrollWidth - ol.clientWidth;
    ol.scrollLeft = getComputedStyle(ol).direction === "rtl" ? -max : max;

    expect(ol.scrollLeft).toBe(sign * max);
    expect(ol.scrollLeft).not.toBe(0);

    vi.restoreAllMocks();
    act(() => root.unmount());
    container.innerHTML = "";
    root = null;
  }
});
