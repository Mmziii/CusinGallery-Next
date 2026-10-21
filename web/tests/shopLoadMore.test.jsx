// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The phone's «نمایش کالاهای بیشتر» is the only part of the shop that talks to
// the API from the browser, so it is the only part that needs a DOM. Next's
// router primitives are doubled (the component only pushes on filter changes),
// and the client API module is mocked: what matters here is WHICH page is
// requested with WHICH filters, that the cards are appended (and the desktop
// list left alone), that the address bar is rewritten, and that the button
// disappears once the API says there is no next page.
const { listProductsMock, pushMock } = vi.hoisted(() => ({
  listProductsMock: vi.fn(),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  usePathname: () => "/shop/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  // `prefetch` is a Next-only anchor prop; drop it so React does not warn.
  default: ({ href, prefetch, children, ...props }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("../utils/behaviour", () => ({ trackEvent: vi.fn() }));
vi.mock("../services/catalogApi", () => ({ listProducts: listProductsMock }));

import ShopView from "../shop/ShopView";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PAGE_SIZE = 20;

const productAt = (n) => ({
  id: n,
  name: `کالا ${n}`,
  slug: `product-${n}`,
  stock_status: "in_stock",
  is_in_stock: true,
  price_info: { price: 100000 + n, compare_at_price: null, is_on_sale: false },
  primary_image: null,
  images: [],
  variants: [],
});

const pagePayload = (page, { nextPage = page + 1 } = {}) => ({
  count: 160,
  next: nextPage ? `http://test/api/v1/products/?page=${nextPage}` : null,
  previous: page > 1 ? `http://test/api/v1/products/?page=${page - 1}` : null,
  results: Array.from({ length: PAGE_SIZE }, (_, index) => productAt((page - 1) * PAGE_SIZE + index + 1)),
});

let container;
let root;

function renderShop(params = {}, products = pagePayload(1)) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(<ShopView params={params} products={products} categories={[]} brands={[]} facets={[]} />);
  });
  return container;
}

const loadMoreButton = () => container.querySelector(".shop__load-more");
const desktopGrid = () => container.querySelector(".product-grid:not(.shop__more-grid)");
const moreGrid = () => container.querySelector(".shop__more-grid");
// One card = one cell; each card renders both responsive variants and links
// its image and its title, so counting links would count one product several
// times.
const cards = (grid) => Array.from(grid.querySelectorAll(".product-grid__cell"));
const slugs = (grid) =>
  Array.from(new Set(cards(grid).map((cell) => cell.querySelector("a[href^='/products/']")?.getAttribute("href"))));

async function clickLoadMore() {
  await act(async () => {
    loadMoreButton().click();
    // Let the awaited client request and the resulting state settle.
    await Promise.resolve();
  });
}

// jsdom has no layout engine, so `matchMedia` does not exist. ProductCard asks
// it which card variant to render; both variants are always in the markup (CSS
// picks), so a stable "no match" stub is enough and keeps this test about
// paging rather than about breakpoints.
const matchMediaStub = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
});

beforeEach(() => {
  window.matchMedia = matchMediaStub;
  listProductsMock.mockReset();
  pushMock.mockReset();
  listProductsMock.mockImplementation((params) => Promise.resolve(pagePayload(Number(params.page))));
  window.history.replaceState(null, "", "/shop/");
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("phone «نمایش کالاهای بیشتر»", () => {
  it("requests the next page with the current filters and appends it", async () => {
    renderShop({ category: "pots", ordering: "price_asc" });

    // Page 1 is the server's page: 20 cards, button present.
    expect(cards(desktopGrid())).toHaveLength(PAGE_SIZE);
    expect(slugs(desktopGrid())).toContain("/products/product-1/");
    expect(cards(moreGrid())).toHaveLength(0);
    expect(loadMoreButton()).not.toBeNull();

    await clickLoadMore();

    // Same filters, page 2 only.
    expect(listProductsMock).toHaveBeenCalledTimes(1);
    expect(listProductsMock).toHaveBeenCalledWith({ category: "pots", ordering: "price_asc", page: "2" });

    // Appended into the phone grid; the desktop grid is untouched.
    expect(slugs(moreGrid())).toHaveLength(PAGE_SIZE);
    expect(slugs(moreGrid())).toContain("/products/product-21/");
    expect(cards(desktopGrid())).toHaveLength(PAGE_SIZE);
    expect(slugs(desktopGrid())).not.toContain("/products/product-21/");

    // The address bar now names the page, so a refresh/share lands there.
    expect(window.location.pathname).toBe("/shop/");
    expect(window.location.search).toBe("?category=pots&ordering=price_asc&page=2");

    // A second click continues from there.
    await clickLoadMore();
    expect(listProductsMock).toHaveBeenLastCalledWith({ category: "pots", ordering: "price_asc", page: "3" });
    expect(slugs(moreGrid())).toHaveLength(2 * PAGE_SIZE);
    expect(slugs(moreGrid())).toContain("/products/product-41/");
    expect(window.location.search).toBe("?category=pots&ordering=price_asc&page=3");
  });

  it("hides the button when the API reports no next page", async () => {
    // The server already rendered the last page: nothing to append.
    renderShop({}, pagePayload(8, { nextPage: null }));
    expect(loadMoreButton()).toBeNull();

    // Or the last page is appended here: the button goes away with it.
    act(() => root.unmount());
    container.remove();
    listProductsMock.mockImplementation(() => Promise.resolve(pagePayload(8, { nextPage: null })));
    renderShop({}, pagePayload(7));
    expect(loadMoreButton()).not.toBeNull();
    await clickLoadMore();
    expect(slugs(moreGrid())).toHaveLength(PAGE_SIZE);
    expect(loadMoreButton()).toBeNull();
  });

  it("drops an in-flight page when the filters change before it lands", async () => {
    let resolveRequest;
    listProductsMock.mockImplementation(
      () => new Promise((resolve) => {
        resolveRequest = resolve;
      })
    );
    renderShop({ category: "pots" });

    await act(async () => {
      loadMoreButton().click();
      await Promise.resolve();
    });
    expect(listProductsMock).toHaveBeenCalledTimes(1);

    // The visitor switches filters while page 2 is still in flight.
    const nextProps = { category: "pans" };
    act(() => {
      root.render(<ShopView params={nextProps} products={pagePayload(1)} categories={[]} brands={[]} facets={[]} />);
    });
    await act(async () => {
      resolveRequest(pagePayload(2));
      await Promise.resolve();
    });

    // Nothing from the abandoned query is appended, and the URL stays put.
    expect(cards(moreGrid())).toHaveLength(0);
    expect(window.location.search).toBe("");
  });

  it("keeps the button and shows a notice when the client request fails", async () => {
    listProductsMock.mockRejectedValueOnce(new Error("network"));
    renderShop({});

    await clickLoadMore();

    expect(container.querySelector(".shop__load-more-error")).not.toBeNull();
    expect(cards(moreGrid())).toHaveLength(0);
    expect(loadMoreButton()).not.toBeNull();
    expect(window.location.search).toBe("");
  });
});
