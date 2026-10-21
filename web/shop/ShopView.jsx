"use client";
import PropTypes from "prop-types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import Breadcrumbs from "../components/Breadcrumbs";
import BrandFilter from "../components/BrandFilter";
import CategoryFilterTree from "../components/CategoryFilterTree";
import PriceRangeFilter from "../components/PriceRangeFilter";
import Icon from "../components/Icon";
import Portal from "../components/Portal";
import ProductCard from "../components/ProductCard";
import useFocusTrap from "../hooks/useFocusTrap";
import { EmptyState, ErrorState } from "../components/ui";
import { faDigits } from "../utils/faDigits";
import { formatPrice } from "../utils/formatPrice";
import { isTruthyParam } from "../utils/queryFlags";
import { brandUrl } from "../utils/brands";
import { categoryChain, categoryUrl } from "../utils/categories";
import { trackEvent } from "../utils/behaviour";
import { pageWindow, readShopPage, shopHref, totalPages as totalPagesFor } from "../utils/shopPaging";
import { listProducts } from "../services/catalogApi";

/**
 * Catalog listing, server-rendered.
 *
 * The markup is the SPA's ShopPage byte for byte in structure and classes; the
 * difference is where the data comes from and how the URL is updated:
 *  - products / categories / brands / facets arrive as props from the server
 *    component (no fetch-on-mount, so the first paint already has the grid);
 *  - every filter, sort and page change writes the SAME query format to the
 *    URL and the server re-renders the page: the desktop pager navigates
 *    (?page=N = page N, exactly the SPA's numbered links), while the phone's
 *    «نمایش کالاهای بیشتر» appends the next page client-side and remembers it
 *    with history.replaceState;
 *  - both responsive variants are in the HTML and CSS picks one: the filter
 *    sidebar is hidden below 768px by stylesheet, the phone toolbar is hidden
 *    above it, and both bottom sheets only exist while opened.
 */

/** Part S5 item 7: max stagger steps (20ms each) for the card entrance. */
const MAX_STAGGER_STEPS = 10;

/**
 * Part S5 item 7: one collapsible filter group. The body animates with a
 * grid-template-rows 0fr -> 1fr transition (no max-height guesswork, so
 * any content height animates correctly) and stays in the DOM the whole
 * time -- inputs keep their state and the group stays keyboard-navigable.
 */
function FilterGroup({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`filter-group${open ? "" : " filter-group--collapsed"}`}>
      <h3>
        <button
          type="button"
          className="filter-group__toggle"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <span>{title}</span>
          <Icon name="chevron-down" size={14} />
        </button>
      </h3>
      <div className="filter-group__body">
        <div className="filter-group__body-inner">{children}</div>
      </div>
    </div>
  );
}

FilterGroup.propTypes = {
  title: PropTypes.string.isRequired,
  children: PropTypes.node,
  defaultOpen: PropTypes.bool,
};

const SORT_OPTIONS = [
  { value: "newest", label: "جدیدترین" },
  { value: "oldest", label: "قدیمی‌ترین" },
  { value: "price_asc", label: "ارزان‌ترین" },
  { value: "price_desc", label: "گران‌ترین" },
];

function ShopView({ params, fixedBrand = null, products, categories = [], brands = [], facets = [] }) {
  const router = useRouter();
  // Both responsive variants are rendered, so the SPA's single `filtersOpen`
  // state is split: one disclosure for the desktop/tablet sidebar and one
  // bottom sheet for the phone toolbar (the sheet must never open on desktop,
  // where nothing can open it and CSS keeps the toolbar hidden).
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filtersSheetOpen, setFiltersSheetOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const filtersSheetRef = useRef(null);
  const sortSheetRef = useRef(null);
  const closeFilters = useCallback(() => setFiltersSheetOpen(false), []);
  const closeSort = useCallback(() => setSortOpen(false), []);
  useFocusTrap(filtersSheetRef, filtersSheetOpen, closeFilters);
  useFocusTrap(sortSheetRef, sortOpen, closeSort);

  const basePath = fixedBrand ? brandUrl(fixedBrand.slug) : "/shop/";
  const currentPage = readShopPage(params.page).page;
  const totalPages = totalPagesFor(products?.count);
  // The server rendered THIS page and only this page (standard pagination).
  const results = products?.results || [];
  const failed = Boolean(products?.error);

  // Phone «نمایش کالاهای بیشتر»: appended pages live here, keyed by the query
  // they were loaded for. A new query (filter, sort or page -- new props) makes
  // that key stale, so the appends, the spinner and the error simply stop
  // applying: no effect, and no stale cards next to a fresh page.
  const paramsKey = JSON.stringify(params);
  const [moreState, setMoreState] = useState({ key: paramsKey, pages: [], loading: false, error: null });
  const more =
    moreState.key === paramsKey
      ? moreState
      : { key: paramsKey, pages: [], loading: false, error: null };
  const extraResults = more.pages.flatMap((entry) => entry.results || []);
  // `next` of the LAST page actually fetched: null hides the button.
  const lastPayload = more.pages.length ? more.pages[more.pages.length - 1] : products;
  const hasNextPage = Boolean(lastPayload?.next);
  const nextPageNumber = (more.pages.length ? more.pages[more.pages.length - 1].page : currentPage) + 1;
  // Lets an in-flight request notice that the query changed under it.
  const paramsKeyRef = useRef(paramsKey);
  paramsKeyRef.current = paramsKey;

  /** Write a new filter set to the URL; the server component re-renders. */
  const pushParams = useCallback(
    (next) => {
      const query = next.toString();
      router.push(query ? `${basePath}?${query}` : basePath, { scroll: false });
    },
    [basePath, router]
  );

  const currentParams = useCallback(() => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      if (fixedBrand && key === "brand") continue;
      next.set(key, String(value));
    }
    return next;
  }, [params, fixedBrand]);

  /**
   * Pagination links: one ?page=N per page, page 1 as the page-less URL.
   * These are real anchors, so a numbered link is a normal navigation with a
   * crawlable, shareable URL -- every page 1..N works.
   */
  const pageHref = useCallback(
    (page) => shopHref(basePath, params, { page, fixedBrand }),
    [basePath, params, fixedBrand]
  );

  /**
   * Phone «نمایش کالاهای بیشتر»: fetch the NEXT page from the public API with
   * exactly the filters in the URL, append its cards under the ones already on
   * screen, and rewrite the address bar to ?page=<that page> (replaceState, so
   * Back still leaves the listing) -- a refresh or a shared link lands on the
   * same page. The desktop grid is a separate element and is unaffected.
   */
  const loadMore = async () => {
    if (more.loading || !hasNextPage) return;
    const requestedKey = paramsKey;
    const page = nextPageNumber;
    setMoreState((previous) => ({
      key: requestedKey,
      pages: previous.key === requestedKey ? previous.pages : [],
      loading: true,
      error: null,
    }));
    try {
      const data = await listProducts({ ...params, page: String(page) });
      // The visitor changed filters while this page was in flight: drop it.
      if (paramsKeyRef.current !== requestedKey) return;
      setMoreState((previous) => ({
        key: requestedKey,
        pages:
          previous.key === requestedKey
            ? [...previous.pages, { page, results: data.results || [], next: data.next }]
            : [],
        loading: false,
        error: null,
      }));
      // The address bar now names this page (no navigation, no re-render):
      // a refresh or a shared link lands on it.
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", pageHref(page));
      }
    } catch (error) {
      if (paramsKeyRef.current !== requestedKey) return;
      setMoreState({ key: requestedKey, pages: [], loading: false, error });
    }
  };

  const setParam = (key, value) => {
    const next = currentParams();
    if (value === "" || value === null || value === undefined) {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    // Any filter change resets to the first page.
    if (key !== "page") next.delete("page");
    pushParams(next);
  };

  // Part R5 item 8: toggle one value inside attr_<attribute-slug>. Values
  // are comma-joined in the URL so a facet selection survives reload and
  // is shareable, exactly like every other filter.
  const selectedAttrValues = (attributeSlug) => {
    const raw = params[`attr_${attributeSlug}`];
    return raw ? String(raw).split(",").filter(Boolean) : [];
  };
  const toggleAttrValue = (attributeSlug, value) => {
    const current = selectedAttrValues(attributeSlug);
    const next = current.includes(value)
      ? current.filter((v) => v !== value)
      : [...current, value];
    setParam(`attr_${attributeSlug}`, next.join(","));
  };

  const selectedCategory = categories.find((c) => c.slug === params.category) || null;
  const categoryCrumbs = categoryChain(params.category, categories).map((category) => ({
    label: faDigits(category.name),
    to: categoryUrl(category),
  }));
  const selectedBrand = fixedBrand || brands.find((b) => b.slug === params.brand) || null;
  const filtered = fixedBrand || selectedCategory || selectedBrand;

  // Behaviour analytics: report each search query WITH its result count. The
  // owner's «جستجوهای بی‌نتیجه» report is built from exactly this pair.
  const trackedSearch = useRef("");
  useEffect(() => {
    const query = String(params.search || "").trim();
    if (!query || !products || typeof products.count !== "number") return;
    const stamp = `${query}|${products.count}`;
    if (trackedSearch.current === stamp) return;
    trackedSearch.current = stamp;
    trackEvent("search", { query, results: products.count });
  }, [params.search, products]);

  // Part S2 item 7: preserve scroll position when the browser goes BACK to
  // this listing (a fresh filter change starts at the saved offset too).
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const key = `cusin.shop.scroll.${fixedBrand?.slug || ""}.${window.location.search}`;
    const entry = window.performance?.getEntriesByType?.("navigation")?.[0];
    if (entry?.type === "back_forward") {
      const saved = window.sessionStorage.getItem(key);
      if (saved) requestAnimationFrame(() => window.scrollTo(0, Number(saved)));
    }
    return () => {
      try {
        window.sessionStorage.setItem(key, String(window.scrollY));
      } catch {
        // Private mode: scroll restoration is a nicety, never a failure.
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedBrand?.slug, paramsKey]);

  const applyPriceRange = ({ min, max }) => {
    const next = currentParams();
    if (min == null) next.delete("min_price");
    else next.set("min_price", String(min));
    if (max == null) next.delete("max_price");
    else next.set("max_price", String(max));
    next.delete("page");
    pushParams(next);
  };

  // Attribute facet keys currently present in the URL (e.g. ["attr_rang"]).
  const attrKeys = Object.keys(params).filter(
    (key) => key.startsWith("attr_") && params[key]
  );

  const clearAllFilters = () => {
    const next = currentParams();
    ["category", "brand", "min_price", "max_price", "in_stock", "on_sale", "page", ...attrKeys].forEach((k) => next.delete(k));
    pushParams(next);
  };

  // Audit 19 item 1: how many filters are active right now -- shown on the
  // phone's «فیلترها» button and in the sheet heading. Paging and sorting are
  // not filters.
  const activeFilterCount =
    ["category", "brand", "min_price", "max_price", "in_stock"].filter((key) => params[key]).length +
    attrKeys.length;

  // ONE filter panel component is used twice (sidebar + phone sheet). Each is
  // its own instance, so its radio group names never collide.
  const filtersPanel = (
    <div className="shop__filters-inner">
      <FilterGroup title="دسته‌بندی">
        <CategoryFilterTree categories={categories} selected={params.category || ""} onChange={(value) => setParam("category", value)} />
      </FilterGroup>

      <FilterGroup title="برند">
        <BrandFilter brands={fixedBrand ? [fixedBrand] : brands} selected={params.brand || ""} locked={Boolean(fixedBrand)} onChange={(value) => setParam("brand", value)} />
      </FilterGroup>

      {/* Part R5 item 8: dynamic attribute facets, one checkbox group
          per attribute that exists on active products (re-scoped to
          the selected category). */}
      {facets.map((attribute) => {
        const selected = selectedAttrValues(attribute.slug);
        return (
          <FilterGroup key={attribute.slug} title={attribute.name}>
            {attribute.values.map((entry) => (
              <label className="checkbox" key={entry.value}>
                <input
                  type="checkbox"
                  checked={selected.includes(entry.value)}
                  onChange={() => toggleAttrValue(attribute.slug, entry.value)}
                />
                {faDigits(entry.value)} <span className="filter-group__count">({faDigits(entry.count)})</span>
              </label>
            ))}
          </FilterGroup>
        );
      })}

      <FilterGroup title="محدوده قیمت (تومان)">
        <PriceRangeFilter
          bounds={products?.price_bounds}
          resultRange={products?.price_range}
          minimum={params.min_price || ""}
          maximum={params.max_price || ""}
          onApply={applyPriceRange}
          scopeKey={`${fixedBrand?.slug || ""}|${JSON.stringify(params)}`}
        />
      </FilterGroup>

      <FilterGroup title="موجودی">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={params.in_stock === "true"}
            onChange={(e) => setParam("in_stock", e.target.checked ? "true" : "")}
          />
          فقط کالاهای موجود
        </label>
      </FilterGroup>

      {/* The daily-deals band's «مشاهده همه» lands here: /shop/?on_sale=true
          (same filter the backend exposes, which also accepts 1/yes -- an old
          bookmark must still read as checked). */}
      <FilterGroup title="تخفیف">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={isTruthyParam(params.on_sale)}
            onChange={(e) => setParam("on_sale", e.target.checked ? "true" : "")}
          />
          فقط کالاهای تخفیف‌دار
        </label>
      </FilterGroup>

      {(params.category || params.brand || params.min_price || params.max_price || params.in_stock || params.on_sale || attrKeys.length > 0) ? (
        <button type="button" className="btn btn--outline btn--sm" onClick={clearAllFilters}>
          حذف همه فیلترها
        </button>
      ) : null}
    </div>
  );

  return (
    <div className="shop">
      <div className="shop__heading">
        {/* Part S2 item 7: breadcrumbs (category chain). Stage 1: every
            storefront trail starts with «کازین گالری», then the deeper
            levels. */}
        <Breadcrumbs
          items={[
            { label: "کازین گالری", to: "/" },
            ...(fixedBrand
              ? [{ label: "برندها" }, { label: faDigits(fixedBrand.name) }]
              : params.category
              ? [{ label: "فروشگاه", to: "/shop/" }, ...categoryCrumbs]
              : [{ label: "فروشگاه" }]),
          ]}
        />
        <h1>{fixedBrand ? `محصولات برند ${faDigits(fixedBrand.name)}` : "فروشگاه"}</h1>
      </div>

      {/* Desktop/tablet sidebar. Hidden below 768px by the stylesheet (the
          phone toolbar opens the same panel in a bottom sheet). */}
      <aside className="shop__sidebar">
        <button
          type="button"
          className="shop__filters-toggle"
          aria-expanded={filtersOpen}
          aria-controls="shop-filters"
          onClick={() => setFiltersOpen((value) => !value)}
        >
          <span>فیلترها</span>
          <Icon name="chevron-down" size={16} />
        </button>

        <div
          className={`shop__filters${filtersOpen ? " shop__filters--open" : ""}`}
          id="shop-filters"
        >
          {filtersPanel}
        </div>
      </aside>

      {filtersSheetOpen ? (
        <Portal>
          <button
            type="button"
            className="sheet-scrim"
            aria-label="بستن فیلترها"
            onClick={closeFilters}
          />
          <div
            className="sheet"
            id="shop-filters-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="فیلترها"
            ref={filtersSheetRef}
          >
            <div className="sheet__head">
              <h2>
                فیلترها
                {activeFilterCount > 0 ? ` (${formatPrice(activeFilterCount)})` : ""}
              </h2>
              <button
                type="button"
                className="sheet__close"
                aria-label="بستن"
                onClick={closeFilters}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="sheet__body">{filtersPanel}</div>
            <div className="sheet__foot">
              {/* Filters apply live -- the URL is the state -- so «اعمال»
                  just closes the sheet and returns to the results. */}
              <button type="button" className="btn btn--primary" onClick={closeFilters}>
                اعمال
              </button>
            </div>
          </div>
        </Portal>
      ) : null}

      {sortOpen ? (
        <Portal>
          <button
            type="button"
            className="sheet-scrim"
            aria-label="بستن مرتب‌سازی"
            onClick={closeSort}
          />
          <div
            className="sheet"
            id="shop-sort-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="مرتب‌سازی"
            ref={sortSheetRef}
          >
            <div className="sheet__head">
              <h2>مرتب‌سازی</h2>
              <button
                type="button"
                className="sheet__close"
                aria-label="بستن"
                onClick={closeSort}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="sheet__body">
              {SORT_OPTIONS.map((option) => (
                <label key={option.value} className="sheet__option">
                  <input
                    type="radio"
                    name="shop-sorting"
                    value={option.value}
                    checked={(params.ordering || "newest") === option.value}
                    onChange={() => {
                      setParam("ordering", option.value);
                      closeSort();
                    }}
                  />
                  {option.label}
                </label>
              ))}
            </div>
            <div className="sheet__foot">
              <button type="button" className="btn btn--outline" onClick={closeSort}>
                بستن
              </button>
            </div>
          </div>
        </Portal>
      ) : null}

      <div className="shop__main">
        {/* Audit 19 item 1: on a phone the sticky toolbar lives INSIDE
            .shop__main -- whose box is the whole results list, so the bar can
            stick for the entire scroll. Displayed below 768px only. */}
        <div className="shop__mobile-bar">
          <button
            type="button"
            className="shop__mobile-btn"
            aria-expanded={filtersSheetOpen}
            aria-controls="shop-filters-sheet"
            onClick={() => setFiltersSheetOpen(true)}
          >
            فیلترها
            {activeFilterCount > 0 ? (
              <span className="shop__mobile-btn__badge">{formatPrice(activeFilterCount)}</span>
            ) : null}
          </button>
          <button
            type="button"
            className="shop__mobile-btn"
            aria-expanded={sortOpen}
            aria-controls="shop-sort-sheet"
            onClick={() => setSortOpen(true)}
          >
            مرتب‌سازی
          </button>
          {products ? (
            <span className="shop__mobile-count">{formatPrice(products.count)} کالا</span>
          ) : null}
        </div>

        <div className="shop__toolbar">
          {/* Part S2 item 7: result count, always derived from the server. */}
          {products ? <span className="shop__count">{formatPrice(products.count)} کالا</span> : null}
          <label>
            مرتب‌سازی:
            <select
              value={params.ordering || "newest"}
              onChange={(e) => setParam("ordering", e.target.value)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>

        {params.search ? (
          <p className="shop__search-note">
            نتایج جستجو برای «{faDigits(params.search)}»
          </p>
        ) : null}

        {/* Part R2: visible active filters (e.g. arriving from a brand tile) */}
        {(() => {
          const brandSlug = fixedBrand ? null : params.brand;
          const brand = brands.find((b) => b.slug === brandSlug);
          const category = categories.find((c) => c.slug === params.category);
          const activeAttrs = attrKeys
            .map((key) => {
              const facet = facets.find((f) => f.slug === key.slice(5));
              return {
                key,
                // Fall back to the raw slug if the facet payload is not
                // loaded (label still stays human-deletable).
                name: facet ? facet.name : key.slice(5),
                values: selectedAttrValues(key.slice(5)).join("، "),
              };
            })
            .filter((entry) => entry.values);
          if (!brand && !category && activeAttrs.length === 0) return null;
          return (
            <div className="shop__chips">
              {brand ? (
                <span className="shop__chip">
                  برند: {faDigits(brand.name)}
                  <button type="button" aria-label="حذف فیلتر برند" onClick={() => setParam("brand", "")}>
                    <Icon name="close" size={14} />
                  </button>
                </span>
              ) : null}
              {category ? (
                <span className="shop__chip">
                  دسته: {faDigits(category.name)}
                  <button type="button" aria-label="حذف فیلتر دسته" onClick={() => setParam("category", "")}>
                    <Icon name="close" size={14} />
                  </button>
                </span>
              ) : null}
              {activeAttrs.map((entry) => (
                <span className="shop__chip" key={entry.key}>
                  {faDigits(entry.name)}: {faDigits(entry.values)}
                  <button type="button" aria-label={`حذف فیلتر ${entry.name}`} onClick={() => setParam(entry.key, "")}>
                    <Icon name="close" size={14} />
                  </button>
                </span>
              ))}
            </div>
          );
        })()}

        {failed ? (
          <ErrorState
            message="دریافت محصولات انجام نشد. لطفاً دوباره تلاش کنید."
            onRetry={() => router.refresh()}
          />
        ) : null}

        {!failed && products ? (
          <div className="shop__results">
            {results.length === 0 ? (
              <EmptyState title="محصولی با این مشخصات پیدا نشد.">
                <p className="muted">فیلترها یا عبارت جستجو را تغییر دهید، یا همه فیلترها را حذف کنید.</p>
                <button type="button" className="btn btn--outline" onClick={clearAllFilters}>
                  حذف همه فیلترها
                </button>
              </EmptyState>
            ) : (
              <div className="product-grid">
                {results.map((product, index) => (
                  <div
                    className="product-grid__cell"
                    // A new result set re-keys the cells so every card replays
                    // its fade+rise (the SPA's `resultsKey`, now the query).
                    key={`${paramsKey}-${product.id}`}
                    style={{ animationDelay: `${Math.min(index, MAX_STAGGER_STEPS) * 20}ms` }}
                  >
                    <ProductCard product={product} />
                  </div>
                ))}
              </div>
            )}

            {/* Phones only: the pages appended by «نمایش کالاهای بیشتر».
                A separate grid, so the desktop list (page N) is identical to
                what the server rendered even after appends. Hidden above
                767px by styles/responsive-variants.css. */}
            <div className={`product-grid shop__more-grid${extraResults.length ? "" : " shop__more-grid--empty"}`}>
              {extraResults.map((product, index) => (
                <div
                  className="product-grid__cell"
                  key={`${paramsKey}-more-${product.id}`}
                  style={{ animationDelay: `${Math.min(index, MAX_STAGGER_STEPS) * 20}ms` }}
                >
                  <ProductCard product={product} />
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {more.error ? (
          <p className="shop__load-more-error" role="alert">
            دریافت کالاهای بیشتر انجام نشد. دوباره تلاش کنید.
          </p>
        ) : null}

        {/* Phones: «نمایش کالاهای بیشتر» appends the NEXT page in the browser
            (same filters, relative API URL) and rewrites the address bar with
            replaceState. Hidden above 768px by CSS; hidden entirely once the
            API says there is no next page. */}
        {!failed && hasNextPage ? (
          <button
            type="button"
            className="btn btn--outline shop__load-more"
            onClick={loadMore}
            disabled={more.loading}
            aria-busy={more.loading || undefined}
          >
            {more.loading ? "در حال دریافت…" : "نمایش کالاهای بیشتر"}
          </button>
        ) : null}

        {!failed && totalPages > 1 ? (
          <nav className="pagination" aria-label="صفحه‌بندی">
            {currentPage > 1 ? (
              <a href={pageHref(currentPage - 1)}>قبلی</a>
            ) : (
              <span aria-disabled="true">قبلی</span>
            )}
            {pageWindow(currentPage, totalPages).map((page) => (
              <a
                key={page}
                aria-current={page === currentPage ? "page" : undefined}
                href={pageHref(page)}
              >
                {faDigits(page)}
              </a>
            ))}
            <span>صفحه {faDigits(currentPage)} از {faDigits(totalPages)}</span>
            {currentPage < totalPages ? (
              <a href={pageHref(currentPage + 1)}>بعدی</a>
            ) : (
              <span aria-disabled="true">بعدی</span>
            )}
          </nav>
        ) : null}
      </div>
    </div>
  );
}

const productsShape = PropTypes.shape({
  count: PropTypes.number,
  next: PropTypes.string,
  previous: PropTypes.string,
  results: PropTypes.array,
  price_bounds: PropTypes.object,
  price_range: PropTypes.object,
  error: PropTypes.object,
});

ShopView.propTypes = {
  params: PropTypes.object.isRequired,
  fixedBrand: PropTypes.object,
  products: productsShape,
  categories: PropTypes.array,
  brands: PropTypes.array,
  facets: PropTypes.array,
};

export default ShopView;
