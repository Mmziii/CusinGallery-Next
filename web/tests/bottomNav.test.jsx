// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("../lib/navigation", () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
  useLocation: () => ({ pathname: nav.pathname, search: "", hash: "" }),
}));

vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

import BottomNav, { BOTTOM_NAV_EVENT, showBottomNav } from "../components/BottomNav";
import ProductCard from "../components/ProductCard";
import useCartStore from "../store/useCartStore";
import { loadDeclarations, matchingDeclarations, winning } from "./helpers/cssCascade";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const declarations = loadDeclarations();
const valueOf = (selector, width, prop) => {
  const rule = winning(matchingDeclarations(declarations, selector, width, { prop }), selector);
  return rule ? rule.value : null;
};

describe("phone bottom tab bar", () => {
  it("is hidden on routes that already have their own fixed bottom bar", () => {
    for (const path of ["/", "/shop/", "/shop/?page=2", "/brands/x/", "/about/", "/account/", "/login/", "/wishlist/"]) {
      expect(showBottomNav(path.split("?")[0])).toBe(true);
    }
    for (const path of ["/products/copper-pot/", "/cart/", "/checkout/", "/payment/result/12/"]) {
      expect(showBottomNav(path)).toBe(false);
    }
  });

  it("CSS: phones only; header duplicates hidden only when the shell has the bar", () => {
    for (const width of [768, 1024, 1366]) {
      expect(valueOf(".bottom-nav", width, "display")).toBe("none");
    }
    for (const width of [320, 375, 414, 767]) {
      expect(valueOf(".bottom-nav", width, "display")).toBe("grid");
      expect(valueOf(".bottom-nav__item", width, "min-height")).toBe("52px");
      for (const dup of [".cart-link", ".user-menu", ".site-header__login", ".site-header__search-toggle"]) {
        expect(valueOf(`.app-shell--tabbar .site-header ${dup}`, width, "display")).toBe("none");
      }
    }
  });

  it("renders five tabs, marks the current one and is absent on the product page", () => {
    nav.pathname = "/";
    const home = renderToStaticMarkup(<BottomNav />);
    for (const label of ["خانه", "دسته‌ها", "جستجو", "سبد", "حساب"]) expect(home).toContain(label);
    expect(home).toMatch(/href="\/"[^>]*aria-current="page"/);
    expect(home).toContain('href="/login/"');

    nav.pathname = "/products/copper-pot/";
    expect(renderToStaticMarkup(<BottomNav />)).toBe("");
    nav.pathname = "/";
  });

  describe("buttons drive the header through one event", () => {
    let root;
    let container;
    beforeEach(() => {
      container = document.createElement("div");
      document.body.appendChild(container);
      root = createRoot(container);
      useCartStore.setState({ cart: { items: [], item_count: 3 } });
    });
    afterEach(() => {
      act(() => root.unmount());
      container.remove();
    });

    it("menu / search / cart dispatch their action and the cart badge shows the count", () => {
      const seen = [];
      const listener = (event) => seen.push(event.detail.action);
      window.addEventListener(BOTTOM_NAV_EVENT, listener);
      act(() => root.render(<BottomNav />));
      const buttons = [...container.querySelectorAll("button")];
      expect(buttons.map((b) => b.textContent.trim().replace(/[۰-۹]/g, ""))).toEqual(["دسته‌ها", "جستجو", "سبد"]);
      act(() => buttons.forEach((b) => b.click()));
      window.removeEventListener(BOTTOM_NAV_EVENT, listener);
      expect(seen).toEqual(["menu", "search", "cart"]);
      expect(container.querySelector(".bottom-nav__badge").textContent).toBe("۳");
    });
  });
});

describe("exact low-stock count", () => {
  const base = {
    id: 7,
    slug: "copper-pot",
    name: "قابلمه مسی",
    price_info: { price: 125000 },
    brand: null,
    images: [],
    primary_image: null,
  };

  it("shows «فقط N عدد مانده» with Persian digits when the API gives a count", () => {
    const html = renderToStaticMarkup(<ProductCard product={{ ...base, stock_status: "low_stock", stock_quantity: 2 }} />);
    expect(html).toContain("فقط ۲ عدد مانده");
    expect(html).not.toContain("تعداد محدود");
  });

  it("keeps the generic label without a usable count", () => {
    for (const stock_quantity of [undefined, null, 0]) {
      const html = renderToStaticMarkup(<ProductCard product={{ ...base, stock_status: "low_stock", stock_quantity }} />);
      expect(html).toContain("تعداد محدود");
    }
  });
});
