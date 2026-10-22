import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DJANGO_OWNED_PREFIXES,
  Link,
  NavLink,
  isDjangoOwnedPath,
  isNextOwnedPath,
  nextHref,
  useNextNavigate,
} from "./nextRoutes";

function Probe() {
  const loc = useLocation();
  return <output data-testid="loc">{loc.pathname + loc.search}</output>;
}

describe("nextRoutes", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("classifies every storefront path as Next-owned and excludes only Django/external paths", () => {
    expect(DJANGO_OWNED_PREFIXES).toEqual([
      "/admin",
      "/api",
      "/payment/callback",
      "/media",
      "/static",
    ]);

    for (const storefrontPath of [
      "/",
      "",
      "/?utm=1",
      "/#top",
      { pathname: "/" },
      "/shop",
      "/shop/",
      "/shop/?category=pots&page=2",
      { pathname: "/shop/", search: "?q=copper" },
      "/products/copper-pot/",
      "/brands/zarin/",
      "/login/",
      "/register/",
      "/password-reset/",
      "/reset-password/uid/token/",
      "/account/",
      "/account/orders/",
      "/wishlist/",
      "/cart/",
      "/checkout/",
      "/payment/result/42/",
      "/about/",
      "/contact/",
      "/shipping-returns/",
      "/terms/",
      "/privacy/",
      "/some/unknown/path/",
      "/about-x/",
      "/admin-guide/",
      "/api-docs/",
      "/payment/callback-help/",
      "/media-kit/",
      "/static-pages/",
    ]) {
      expect(isNextOwnedPath(storefrontPath)).toBe(true);
    }

    for (const djangoPath of [
      "/admin",
      "/admin/",
      "/admin/login/",
      "/admin/products/product/image-import/",
      "/api",
      "/api/",
      "/api/v1/products/",
      "/payment/callback",
      "/payment/callback/",
      "/payment/callback/?Authority=A000&Status=OK",
      "/media",
      "/media/",
      "/media/products/pot.jpg",
      "/static",
      "/static/",
      "/static/admin/css/base.css",
    ]) {
      expect(isDjangoOwnedPath(djangoPath)).toBe(true);
      expect(isNextOwnedPath(djangoPath)).toBe(false);
    }

    expect(isNextOwnedPath("https://cusin.ir/shop/")).toBe(false);
    expect(isNextOwnedPath("//cusin.ir/shop/")).toBe(false);
    expect(isNextOwnedPath("mailto:support@cusin.ir")).toBe(false);
    expect(isNextOwnedPath("tel:02112345678")).toBe(false);
    expect(nextHref({ pathname: "/shop/", search: "?p=2", hash: "#top" })).toBe("/shop/?p=2#top");
  });

  it("<Link> leaves the SPA via document navigation for storefront and Django paths alike", () => {
    render(
      <MemoryRouter initialEntries={["/about/"]}>
        <Link to="/">home</Link>
        <Link to={{ pathname: "/shop/", search: "?category=pots" }}>pots</Link>
        <Link to="/contact/">contact</Link>
        <Link to="/admin/">admin</Link>
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByRole("link", { name: "pots" }).getAttribute("href")).toBe(
      "/shop/?category=pots"
    );

    // Prevent jsdom's unimplemented navigation noise while proving react-router
    // never intercepted any link.
    for (const name of ["home", "pots", "contact", "admin"]) {
      const link = screen.getByRole("link", { name });
      link.addEventListener("click", (e) => e.preventDefault());
      fireEvent.click(link);
      expect(screen.getByTestId("loc").textContent).toBe("/about/");
    }
  });

  it("<NavLink> computes active state without engaging react-router", () => {
    render(
      <MemoryRouter initialEntries={["/shop/"]}>
        <NavLink to="/" end className={({ isActive }) => (isActive ? "on" : "off")}>
          home
        </NavLink>
        <NavLink to="/shop/" className={({ isActive }) => (isActive ? "on" : "off")}>
          shop
        </NavLink>
        <NavLink to="/about/" className={({ isActive }) => (isActive ? "on" : "off")}>
          about
        </NavLink>
      </MemoryRouter>
    );

    const home = screen.getByRole("link", { name: "home" });
    const shop = screen.getByRole("link", { name: "shop" });
    const about = screen.getByRole("link", { name: "about" });
    expect(home.className).toBe("off");
    expect(home.getAttribute("aria-current")).toBeNull();
    expect(shop.className).toBe("on");
    expect(shop.getAttribute("aria-current")).toBe("page");
    expect(about.className).toBe("off");
  });

  it("useNextNavigate uses window.location for path navigations and history for numeric steps", () => {
    const assign = vi.fn();
    const replace = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, replace });

    function Buttons() {
      const navigate = useNextNavigate();
      return (
        <>
          <button type="button" onClick={() => navigate("/shop/?q=mug")}>
            search
          </button>
          <button type="button" onClick={() => navigate("/", { replace: true })}>
            home
          </button>
          <button type="button" onClick={() => navigate("/privacy/")}>
            privacy
          </button>
          <button type="button" onClick={() => navigate(-1)}>
            back
          </button>
        </>
      );
    }

    render(
      <MemoryRouter initialEntries={["/first/", "/about/"]} initialIndex={1}>
        <Buttons />
        <Routes>
          <Route path="*" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole("button", { name: "search" }));
    expect(assign).toHaveBeenCalledWith("/shop/?q=mug");
    expect(screen.getByTestId("loc").textContent).toBe("/about/");

    fireEvent.click(screen.getByRole("button", { name: "home" }));
    expect(replace).toHaveBeenCalledWith("/");

    fireEvent.click(screen.getByRole("button", { name: "privacy" }));
    expect(assign).toHaveBeenCalledWith("/privacy/");
    expect(screen.getByTestId("loc").textContent).toBe("/about/");

    fireEvent.click(screen.getByRole("button", { name: "back" }));
    expect(screen.getByTestId("loc").textContent).toBe("/first/");
  });
});
