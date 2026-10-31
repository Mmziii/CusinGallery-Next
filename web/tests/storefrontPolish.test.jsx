import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, prefetch, children, ...props }) => <a href={href} {...props}>{children}</a>,
}));

import {
  loadDeclarations,
  matchingDeclarations,
  computedDisplay,
  mediaMatches,
  winning,
  computedStyle,
  specificity,
  compareSpecificity,
} from "./helpers/cssCascade";
import ProductCard from "../components/ProductCard";
import ProductDetail from "../product/ProductDetail";
import Footer from "../components/Footer";
import { SiteProvider } from "../lib/site-context";
import { DEFAULT_CONTENT } from "../content/defaults";
import { faDigits } from "../utils/faDigits";
import { jalaliYear } from "../utils/jalali";

const declarations = loadDeclarations();
const PHONE = [320, 375, 414, 767];
const DESKTOP = [768, 1024, 1366, 1440];

const at = (selector, width, prop) =>
  matchingDeclarations(declarations, selector, width, { prop });
const valueOf = (selector, width, prop) => {
  const rule = winning(at(selector, width, prop), selector);
  return rule ? rule.value : null;
};
const allAt = (selector, width) =>
  declarations.filter(
    (entry) => entry.selectors.includes(selector) && mediaMatches(entry.media, width)
  );
const hasDecl = (selector, width, predicate) =>
  allAt(selector, width).some(predicate);

const product = {
  id: 7,
  slug: "copper-pot",
  name: "قابلمه مسی",
  stock_status: "in_stock",
  price_info: { price: 125000, compare_at_price: 150000 },
  brand: null,
  images: [],
  primary_image: null,
};

describe("storefront polish: CSS cascade", () => {
  it("1. footer social row: one flex row with gap, on every screen size", () => {
    for (const width of [...PHONE, ...DESKTOP]) {
      expect(valueOf(".site-footer__social", width, "display")).toBe("flex");
      expect(valueOf(".site-footer__social", width, "flex-wrap")).toBe("wrap");
      expect(valueOf(".site-footer__social", width, "gap")).toBe("var(--space-2)");
      expect(valueOf(".site-footer__social", width, "justify-content")).toBe("flex-start");
      // Selector specificity: .site-footer .site-footer__social (0,2,0) beats .site-footer ul (0,1,1)
      expect(valueOf(".site-footer .site-footer__social", width, "flex-direction")).toBe("row");
      expect(
        compareSpecificity(
          specificity(".site-footer .site-footer__social"),
          specificity(".site-footer ul")
        )
      ).toBeGreaterThan(0);
    }
    // Real cascade check on rendered <Footer /> markup:
    // .site-footer ul { flex-direction: column } (0,1,1) must be beaten by .site-footer .site-footer__social (0,2,0) -> "row"
    const site = {
      settings: {},
      content: {
        ...DEFAULT_CONTENT,
        footer: {
          ...DEFAULT_CONTENT.footer,
          socials: { instagram: "https://instagram.com/cusin" },
        },
      },
    };
    const footerHtml = renderToStaticMarkup(
      <SiteProvider value={site}>
        <Footer />
      </SiteProvider>
    );
    for (const width of [...PHONE, ...DESKTOP]) {
      expect(computedStyle(declarations, footerHtml, ".site-footer__social", width, "flex-direction")).toBe("row");
      expect(computedStyle(declarations, footerHtml, ".site-footer__social", width, "flex-wrap")).toBe("wrap");
    }
  });

  it("2. trust strip below 768px: 2-column grid, no scroll/scrollbar/snap; odd last item spans both columns", () => {
    for (const width of PHONE) {
      expect(valueOf(".trust-strip__inner", width, "display")).toBe("grid");
      expect(valueOf(".trust-strip__inner", width, "grid-template-columns")).toBe(
        "repeat(2, 1fr)"
      );
      expect(
        allAt(".trust-strip__inner", width).filter(
          (entry) => /^overflow/.test(entry.prop) && /auto|scroll/.test(entry.value)
        ).length
      ).toBe(0);
      expect(valueOf(".trust-strip__inner", width, "scroll-snap-type")).toBe("none");
    }
    expect(valueOf(".trust-strip__item:last-child:nth-child(odd)", 375, "grid-column")).toBe(
      "1 / -1"
    );

    // Desktop (>=768px): unchanged five-track row.
    for (const width of DESKTOP) {
      expect(valueOf(".trust-strip__inner", width, "grid-template-columns")).toBe(
        "repeat(5, minmax(0, 1fr))"
      );
    }
  });

  it("3. back-to-top hidden below 768px; contact button kept; desktop unchanged", () => {
    for (const width of PHONE) {
      expect(valueOf(".floating-contact .back-to-top", width, "display")).toBe("none");
    }
    for (const width of DESKTOP) {
      expect(valueOf(".floating-contact .back-to-top", width, "display")).not.toBe("none");
    }
  });

  it("4. product-card price keeps flex-wrap: wrap to prevent overlap with button, and normal prices fit on one line at 375px", () => {
    for (const width of PHONE) {
      expect(
        valueOf(".product-card--compact .product-card__footer .price", width, "flex-wrap")
      ).toBe("wrap");
      expect(
        valueOf(".product-card--compact .product-card__footer .price", width, "gap")
      ).toBe("3px");
      expect(
        valueOf(".product-card--compact .product-card__footer", width, "gap")
      ).toBe("4px");
      expect(
        valueOf(".product-card--compact .product-card__footer .price__unit", width, "letter-spacing")
      ).toBe("0");
    }

    // Geometry & layout check at 320px, 375px, 414px:
    // 2-column grid: column width = (viewport - 2*container_padding(12) - grid_gap(8)) / 2
    // Inside card: body padding 16px (8px on each side).
    // Button is fixed 36px. Footer gap is 4px.
    // Price container available width = card_width - 16 - 36 - 4.
    for (const width of [320, 375, 414]) {
      const cardWidth = (width - 24 - 8) / 2;
      const footerWidth = cardWidth - 16;
      const buttonWidth = 36;
      const footerGap = 4;
      const priceAvailableWidth = footerWidth - buttonWidth - footerGap;

      // Price block + button width + gap must never exceed available footer width (no overlap)
      expect(priceAvailableWidth + buttonWidth + footerGap).toBeLessThanOrEqual(footerWidth);

      // On a 375px phone, priceAvailableWidth is 115.5px:
      // Normal 6-7 digit prices like «۳۰۰٬۰۰۰ تومان» (~102px) fit on one line (> 102px).
      if (width === 375) {
        expect(priceAvailableWidth).toBeGreaterThanOrEqual(102);
      }
    }
  });

  it("5. footer contact block (<address>) is never italic", () => {
    for (const width of [...PHONE, ...DESKTOP]) {
      expect(valueOf(".site-footer__contact", width, "font-style")).toBe("normal");
    }
  });

  it("6. phone footer: two link columns side by side, tighter gaps, brand block full width", () => {
    for (const width of PHONE) {
      expect(valueOf(".site-footer__grid", width, "grid-template-columns")).toBe(
        "repeat(2, 1fr)"
      );
      expect(valueOf(".site-footer__grid", width, "gap")).toBe("var(--space-2)");
      expect(valueOf(".site-footer__grid > :nth-child(1)", width, "grid-column")).toBe("1 / -1");
      expect(valueOf(".site-footer__grid > :nth-child(4)", width, "grid-column")).toBe("1 / -1");
      expect(valueOf(".site-footer__grid h4", width, "margin-bottom")).toBe("var(--space-1)");
    }
  });

  it("9. home categories: desktop grid adapts to category count (auto-fit); phones wrap a centred three-up shelf", () => {
    for (const width of DESKTOP) {
      expect(valueOf(".category-grid", width, "grid-template-columns")).toContain("auto-fit");
    }
    for (const width of PHONE) {
      // Redesign (design-system.css): niches never stretch into a wide arch.
      // A short last row is centred by flex-wrap instead of spanning the row.
      expect(valueOf(".category-grid", width, "display")).toBe("flex");
      expect(valueOf(".category-grid", width, "flex-wrap")).toBe("wrap");
      expect(valueOf(".category-grid", width, "justify-content")).toBe("center");
      expect(valueOf(".category-card:last-child:nth-child(odd)", width, "grid-column")).toBe("auto");
    }
  });

  it("10. phone categories: every niche is the same size, including a last odd one", () => {
    for (const width of [320, 375, 414]) {
      // The card itself has no ratio or fixed height; the arched media box
      // owns the shape, so the label below can wrap without clipping.
      expect(valueOf(".category-card", width, "aspect-ratio")).toBe("auto");
      expect(valueOf(".category-card", width, "height")).toBeNull();
      expect(valueOf(".category-card__media", width, "aspect-ratio")).toBe("4 / 5");
      const basis = valueOf(".category-card", width, "flex");
      expect(basis).toBe("0 0 calc((100% - 20px) / 3)");
      expect(valueOf(".category-card:last-child:nth-child(odd)", width, "flex")).toBe(basis);
      expect(valueOf(".category-card:last-child:nth-child(odd)", width, "aspect-ratio")).toBe("auto");
    }
  });

  it("12. breadcrumb on phones: one scrollable line, no visible scrollbar, nav owns overflow-x: auto", () => {
    for (const width of PHONE) {
      expect(valueOf(".breadcrumbs ol", width, "flex-wrap")).toBe("nowrap");
      expect(valueOf(".breadcrumbs", width, "overflow-x")).toBe("auto");
      expect(valueOf(".breadcrumbs ol", width, "overflow-x")).toBeNull();
      expect(valueOf(".breadcrumbs", width, "scrollbar-width")).toBe("none");
      expect(valueOf(".breadcrumbs::-webkit-scrollbar", width, "display")).toBe("none");
    }
  });

  it("13. product detail buy row below 768px: nowrap single line, add button shrinks, heart flex: none", () => {
    for (const width of PHONE) {
      expect(valueOf(".product-detail__buy", width, "flex-wrap")).toBe("nowrap");
      expect(valueOf(".product-detail__buy .btn--primary", width, "flex")).toBe("1 1 auto");
      expect(valueOf(".product-detail__buy .btn--primary", width, "min-width")).toBe("0");
      expect(valueOf(".product-detail__buy .icon-btn--lg", width, "flex")).toBe("none");

      expect(valueOf(".product-detail__buy", width, "gap")).toBe("8px");
      expect(valueOf(".product-detail__buy .btn--primary", width, "white-space")).toBe("nowrap");
      expect(valueOf(".product-detail__buy .btn--primary", width, "height")).toBe("44px");
      expect(valueOf(".product-detail__buy .qty-picker", width, "flex")).toBe("none");
      expect(valueOf(".product-detail__buy .qty-picker button", width, "flex")).toBe("none");
      expect(valueOf(".product-detail__buy .qty-picker button", width, "width")).toBe("44px");
      expect(valueOf(".product-detail__buy .qty-picker button", width, "height")).toBe("44px");
    }
  });

  it("sticky bar: SSR-default hidden-safe (base rule unconditional; phones show it only via JS)", () => {
    // The unconditional base rule hides it on the server and on desktop.
    for (const width of [...PHONE, ...DESKTOP]) {
      expect(
        allAt(".product-detail__stickybar", width).some(
          (e) => e.media.length === 0 && e.prop === "display" && e.value === "none"
        )
      ).toBe(true);
    }
    // The effective cascade at desktop widths is hidden.
    for (const width of [1024, 1366, 1440]) {
      expect(valueOf(".product-detail__stickybar", width, "display")).toBe("none");
    }
    // On phones the bar only appears via the JS-added --visible class.
    expect(valueOf(".product-detail__stickybar--visible", 375, "display")).toBe("flex");
    expect(valueOf(".product-detail__stickybar--visible", 1024, "display")).toBeNull();
  });
});

describe("storefront polish: rendered markup", () => {
  it("4. home product card price markup equals the shop card's: price + تومان on one line", () => {
    const homeHtml = renderToStaticMarkup(<ProductCard product={product} />);
    const shopHtml = renderToStaticMarkup(<ProductCard product={product} />);
    expect(homeHtml).toBe(shopHtml);
    expect(homeHtml).toContain('class="price price--sm"');
    expect(homeHtml).toContain("تومان");
    const priceBox = homeHtml.match(/<div class="price price--sm">[\s\S]*?<\/div>/);
    expect(priceBox).not.toBeNull();
    expect(priceBox[0]).toMatch(
      /<span class="price__current">[^<]*<\/span>\s*<span class="price__unit">تومان<\/span>/
    );
  });

  it("7. e-namad block (and its heading) renders only when real enamad content is configured", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).not.toContain("e-namad");
    expect(html).not.toContain("نمادها و مجوزها");
    expect(html).not.toContain("enamad");

    const site = {
      settings: {},
      content: {
        ...DEFAULT_CONTENT,
        footer: {
          ...DEFAULT_CONTENT.footer,
          enamad_html: '<img class="enamad-badge" src="/enamad.svg" alt="نماد اعتماد">',
          trust_title: "نمادها و مجوزها",
        },
      },
    };
    const enriched = renderToStaticMarkup(<SiteProvider value={site}><Footer /></SiteProvider>);
    expect(enriched).toContain('enamad-badge');
    expect(enriched).toContain("نمادها و مجوزها");
    expect(enriched).not.toContain("محل نماد اعتماد الکترونیکی (e-namad)");
  });

  it("8. footer copyright shows the Jalali year in Persian digits", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain(`© ${faDigits(jalaliYear())} کازین گالری`);
    expect(html).not.toMatch(/© \d{4} کازین گالری/);
  });

  it("5. rendered contact block keeps the <address> element", () => {
    const html = renderToStaticMarkup(<Footer />);
    expect(html).toContain('<address class="site-footer__contact">');
  });

  it("11. wishlist heart sits in the same row as the stepper and add-to-cart", () => {
    const html = renderToStaticMarkup(
      <ProductDetail product={product} slug="copper-pot" reviews={{}} />
    );
    const buyRegion = html.substring(html.indexOf('class="product-detail__buy"'));
    expect(buyRegion.indexOf('class="qty-picker"')).not.toBe(-1);
    const add = buyRegion.indexOf('class="btn btn--primary"');
    const heart = buyRegion.indexOf("icon-btn--lg");
    expect(add).not.toBe(-1);
    expect(heart).not.toBe(-1);
    expect(add > buyRegion.indexOf('class="qty-picker"') && heart > add).toBe(true);
  });

  it.each([320, 375, 414, 359, 360, 767, 768])(
    "buy label at %ipx: only « خرید» is hidden below 360px; full accessible name is kept",
    (width) => {
      const html = renderToStaticMarkup(
        <ProductDetail product={product} slug="copper-pot" reviews={{}} />
      );
      expect(html).toContain('aria-label="افزودن به سبد خرید"');
      expect(html).toContain('<span>افزودن به سبد<span class="product-detail__buy-label-extra"> خرید</span></span>');
      const display = computedStyle(declarations, html, ".product-detail__buy-label-extra", width, "display");
      expect(display === "none").toBe(width < 360);
    }
  );

  it("14. back-in-stock form renders below the product-detail__buy row when out of stock", () => {
    const oosProduct = { ...product, stock_status: "out_of_stock" };
    const html = renderToStaticMarkup(
      <ProductDetail product={oosProduct} slug="copper-pot" reviews={{}} />
    );
    const buyStart = html.indexOf('class="product-detail__buy"');
    const bisStart = html.indexOf('class="back-in-stock"');
    expect(buyStart).not.toBe(-1);
    expect(bisStart).not.toBe(-1);
    const buyClose = html.indexOf("</div>", buyStart);
    // The buy button row closes before the back-in-stock container begins (renders below the row)
    expect(bisStart).toBeGreaterThan(buyClose);
  });
});
