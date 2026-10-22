/**
 * Phases 2–3b: the SPA must hand Next-owned routes to the browser.
 *
 * Clicking a react-router <Link> to "/", "/shop/...", "/products/...",
 * "/brands/...", auth/account/wishlist, or "/cart/", "/checkout/", "/payment/..."
 * used to render the SPA's own retired copy of that page. The helper in
 * utils/nextRoutes is the single switchboard: Next-owned URLs become plain
 * <a href> document links, while static info pages keep react-router.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Link, NavLink, isNextOwnedPath, useNextNavigate } from "./nextRoutes";

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{`${pathname}${search}`}</output>;
}

// jsdom cannot perform a real navigation; blocking the default action keeps
// the run quiet while React's own handlers (if any) still execute.
function blockDocumentNavigation() {
  const handler = (event) => {
    if (event.target instanceof Element && event.target.closest("a[href]")) event.preventDefault();
  };
  document.addEventListener("click", handler, true);
  return () => document.removeEventListener("click", handler, true);
}

function renderAt(route, children) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      {children}
      <LocationProbe />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("isNextOwnedPath", () => {
  it.each([
    "/",
    "/shop",
    "/shop/",
    "/shop/?category=pots",
    "/products/copper-pot/",
    "/brands/mes-karan/",
    "/login/",
    "/account/orders/",
    "/cart/",
    "/checkout/",
    "/checkout/?step=delivery",
    "/payment/result/",
    "/payment/result/42/",
  ])("claims %s", (path) => expect(isNextOwnedPath(path)).toBe(true));

  it.each(["/about/", "/contact/", "/shipping-returns/", "/terms/", "/privacy/", "/shopping-bags/", "/product-tour/"])(
    "leaves %s to the SPA",
    (path) => expect(isNextOwnedPath(path)).toBe(false)
  );
});

describe("Link", () => {
  it.each([
    ["/", "/about/"],
    ["/shop/", "/about/"],
    ["/shop/?category=pots", "/about/"],
    ["/products/copper-pot/", "/contact/"],
    ["/brands/mes-karan/", "/terms/"],
    ["/login/?next=%2Fcheckout%2F", "/privacy/"],
    ["/account/orders/?x=1", "/about/"],
    ["/cart/", "/about/"],
    ["/checkout/?step=delivery", "/about/"],
    ["/payment/result/42/", "/about/"],
  ])("renders a plain anchor for the Next-owned %s", (to, route) => {
    const release = blockDocumentNavigation();
    renderAt(
      route,
      <Link to={to} className="brand-link">
        go
      </Link>
    );

    const anchor = screen.getByText("go");
    expect(anchor.tagName).toBe("A");
    expect(anchor.getAttribute("href")).toBe(to);
    expect(anchor.className).toBe("brand-link");

    fireEvent.click(anchor);
    // No react-router transition: the URL the SPA is on does not change.
    expect(screen.getByTestId("location").textContent).toBe(route);
    release();
  });

  it("keeps react-router for SPA-owned pages", () => {
    renderAt("/", <Link to="/about/">about</Link>);
    fireEvent.click(screen.getByText("about"));
    expect(screen.getByTestId("location").textContent).toBe("/about/");
  });
});

describe("NavLink", () => {
  it("marks the active Next-owned page and stays a document link", () => {
    renderAt(
      "/shop/",
      <NavLink to="/shop/" end className={({ isActive }) => (isActive ? "selected" : "idle")}>
        shop
      </NavLink>
    );
    const anchor = screen.getByText("shop");
    expect(anchor.tagName).toBe("A");
    expect(anchor.getAttribute("href")).toBe("/shop/");
    expect(anchor.getAttribute("aria-current")).toBe("page");
    expect(anchor.className).toBe("selected");
  });
});

describe("useNextNavigate", () => {
  function NavTo({ to }) {
    const navigate = useNextNavigate();
    return (
      <button type="button" onClick={() => navigate(to)}>
        go {to}
      </button>
    );
  }

  it.each(["/shop/?search=pot", "/login/?next=%2Fcheckout%2F", "/account/orders/?x=1", "/cart/", "/checkout/?step=delivery", "/payment/result/42/"])(
    "navigates the DOCUMENT for the Next-owned %s",
    (to) => {
      const assign = vi.fn();
      vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign, replace: vi.fn() });
      renderAt("/about/", <NavTo to={to} />);

      fireEvent.click(screen.getByText(`go ${to}`));

      expect(assign).toHaveBeenCalledWith(to);
      expect(screen.getByTestId("location").textContent).toBe("/about/");
    }
  );

  it("keeps the router for an SPA-owned route", () => {
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign, replace: vi.fn() });
    renderAt(
      "/about/",
      <Routes>
        <Route path="/about/" element={<NavTo to="/contact/" />} />
        <Route path="/contact/" element={<p>contact page</p>} />
      </Routes>
    );

    fireEvent.click(screen.getByText("go /contact/"));

    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText("contact page")).toBeTruthy();
  });
});
