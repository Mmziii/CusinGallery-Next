/*
 * A route-level crash must not make its fallback permanent. The real layout
 * keeps the header outside its Outlet boundary, so its logo and primary nav
 * are the two recovery paths a shopper actually has after a bad route.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MainLayout from "./MainLayout";
import useAuthStore from "../store/useAuthStore";
import useCartStore from "../store/useCartStore";

function BrokenRoute() {
  throw new Error("route crashed");
}

function SearchRoute() {
  const location = useLocation();
  if (location.search.includes("broken")) throw new Error("search route crashed");
  return <h1>جستجوی بازیابی‌شده</h1>;
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<MainLayout />}>
          <Route path="/broken/" element={<BrokenRoute />} />
          <Route path="/" element={<h1>خانهٔ بازیابی‌شده</h1>} />
          <Route path="/shop/" element={<SearchRoute />} />
          <Route path="/about/" element={<h1>دربارهٔ ما بازیابی‌شده</h1>} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false, error: null });
  useCartStore.setState({
    cart: null,
    guestLines: [],
    guestProducts: {},
    guestVariants: {},
    guestHydration: "ready",
    guestHydrationError: null,
    error: null,
  });
});

afterEach(() => cleanup());

describe("route error recovery navigation", () => {
  it("keeps the header logo reachable from the fallback as a document link home", async () => {
    // Phase 2: "/" belongs to the Next app, so recovery navigates the DOCUMENT
    // (the SPA never renders that page itself any more).
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderAt("/broken/");
    expect(await screen.findByText("مشکلی پیش آمد")).toBeTruthy();

    const logo = screen.getByRole("link", { name: "کازین گالری — صفحه اصلی" });
    expect(logo.tagName).toBe("A");
    expect(logo.getAttribute("href")).toBe("/");
    spy.mockRestore();
  });

  it("resets the route boundary after navigating to a page the SPA still owns", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderAt("/broken/");
    expect(await screen.findByText("مشکلی پیش آمد")).toBeTruthy();

    // The footer keeps linking the SPA's static info pages.
    fireEvent.click(screen.getByRole("link", { name: "دربارهٔ ما" }));

    expect(await screen.findByRole("heading", { name: "دربارهٔ ما بازیابی‌شده" })).toBeTruthy();
    expect(screen.queryByText("مشکلی پیش آمد")).toBeNull();
    spy.mockRestore();
  });

  it("hands the primary «فروشگاه» entry to the Next shop as a document link", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderAt("/broken/");
    expect(await screen.findByText("مشکلی پیش آمد")).toBeTruthy();

    const header = document.querySelector(".site-header");
    const shop = within(header).getByRole("link", { name: "فروشگاه" });
    expect(shop.getAttribute("href")).toBe("/shop/");
    spy.mockRestore();
  });

  it("sends the header search to the Next shop (document navigation)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const assign = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, assign, replace: vi.fn() });
    renderAt("/about/");

    const search = screen.getByRole("searchbox", { name: "جستجوی محصول" });
    fireEvent.change(search, { target: { value: "قابلمه" } });
    fireEvent.submit(search.closest("form"));

    // /shop/?search=… is Next-owned: the whole document moves, so the SPA's
    // error boundary is irrelevant by construction.
    expect(assign).toHaveBeenCalledWith("/shop/?search=%D9%82%D8%A7%D8%A8%D9%84%D9%85%D9%87");
    spy.mockRestore();
  });
});
