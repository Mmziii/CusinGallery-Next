# Phases 1–2: Next home + server-rendered catalog

JavaScript App Router, Next 16.4.2, standalone output. All dependencies/assets are local to `web/`; there are no imports from `frontend/`. The SPA and the Django backend keep working unchanged; the migration is page by page.

## What is server-rendered now

| Route | Source of truth in this repo |
|---|---|
| `/` | `app/page.js` + `home/Home.jsx` (phase 1) |
| `/shop/` (with `?category=`, `?brand=`, `?search=`, `?min_price=`, `?max_price=`, `?in_stock=`, `?on_sale=`, `?ordering=`, `?page=`, `?attr_<slug>=`) | `app/shop/page.js` + `shop/ShopView.jsx` |
| `/products/<slug>/` | `app/products/[slug]/page.js` + `product/ProductDetail.jsx` |
| `/brands/<slug>/` | `app/brands/[slug]/page.js` (same listing view, brand-scoped) |

Everything else (cart, checkout, account, auth, wishlist, info pages) is still the Vite SPA in `frontend/`.

## Files and boundaries

- `app/layout.js`: request-rendered Persian RTL document, inline owner theme, font preload and the original CSS import order.
- `app/page.js`, `home/`: home server fetching/composition and the original home markup.
- `app/shop/page.js`, `app/products/[slug]/page.js`, `app/brands/[slug]/page.js`: catalog server components — query parsing, Django reads, metadata, JSON-LD, `notFound()`.
- `shop/ShopView.jsx`: the SPA `ShopPage` markup and behaviour as a client island (filter panel, phone sheets, sticky bar, sorting, paging) fed by server data.
- `product/ProductDetail.jsx`, `product/ReviewsSection.jsx`: product page; reviews summary + first page arrive server-rendered, the form/pagination stay client-side.
- `components/`: phase-1 copies plus `Breadcrumbs`, `CategoryFilterTree`, `BrandFilter`, `PriceRangeFilter`, `ProductGallery`, `ProductLightbox`, `JsonLd`, `NotFoundPage`.
- `lib/api-server.js`: internal Django requests over `node:http` (never `fetch`: undici drops the Host header and Django answers `DisallowedHost`), public Host/protocol forwarding, 60-second public cache for catalog data, `privateData` (cookie, uncached) and `noCache` (public, uncached) modes. Errors carry `status` so a 404 becomes a real not-found page.
- `lib/catalog-server.js`: shop/product/brand reads, the shop's parameter whitelist (`attr_*` facets included), the `?page=N` = first N pages pager and facet scoping.
- `lib/jsonld.js`, `lib/metadata.js`, `lib/site.js`: structured data (Product with IRR prices, BreadcrumbList, WebSite, Organization), titles/descriptions/canonical/OpenGraph, canonical origin.
- `lib/navigation.jsx`: Next links/router for pages this app renders; ordinary anchors/document navigation for every route the SPA still owns.
- `styles/`: unchanged copies plus the additive `responsive-variants.css`, which is the ONLY place viewport width selects between the two server-rendered variants.
- `tests/phase1.test.jsx`, `tests/phase2.test.jsx`, `tests/api-server.test.jsx`: Node-only tests against a real throwaway `node:http` Django stand-in.

## Routing and deployment

Nginx (all three configs: `nginx/conf.d/cusin.conf`, `nginx/prod.d/cusin.conf`, `nginx/prod.d/00-bootstrap-http.conf.example`) sends `/shop/`, `/products/<slug>/`, `/brands/<slug>/`, `/` and `/_next/` to `web:3000` with `Host $http_host` and the `X-Forwarded-*` chain; `/robots.txt` and `/sitemap.xml` stay on Django and every other page stays on the SPA container. The old User-Agent `map` and the `/seo/...` rewrites are gone: Next serves real HTML to bots and humans alike.

`next.config.mjs` sets `trailingSlash: true`, so `/shop/`, `/products/<slug>/` and `/brands/<slug>/` keep the exact URL shape the storefront always had (old links, the Django sitemap and the canonicals stay valid); `/shop` 308-redirects to `/shop/`.

Runtime: `INTERNAL_API_URL=http://backend:8000`; `SITE_ORIGIN` (or `NEXT_PUBLIC_SITE_ORIGIN`) is the canonical origin, default `https://cusin.ir`. Django must allow the public Host.

```sh
cd web
npm ci
npm test
npm run build
```

## Parity notes / deliberate differences

- Markup, class names and structure are the SPA's (`ShopPage.jsx`, `ProductDetailPage.jsx`, `BrandPage.jsx` and their components), now rendered from server data. A failed catalog API still renders the same error markup with a retry control (it re-runs the server render instead of an Axios request).
- Responsive markup: nothing is chosen by `useMediaQuery`/window width except toast wording. The filter sidebar and the phone toolbar, the product `<section>`s and phone `<details>` accordions, and both product-card variants are all in the HTML; `styles/responsive-variants.css` + the existing breakpoints pick one with `display: none`, which also removes the hidden copy from the tab order.
- **Complements are intentionally not rendered**, matching the SPA: `ProductDetailPage.complements.test.jsx` asserts that the API's `complements` rows never appear, so the Next page renders `related_products` only.
- Prices: the page shows whole Toman (as before); the JSON-LD `Offer` publishes Rial (`Toman × 10`) with `priceCurrency: "IRR"`, per phase 2.
- `og:type` is `website` on product pages. Next validates the OpenGraph type against its own enum and `product` is not part of it (it throws and the whole metadata object is dropped); the product signal lives in the JSON-LD `Product` instead.
- Unknown product/brand slugs call `notFound()`: the response status is a real 404 and Next emits `<meta name="robots" content="noindex">`. In Next 16 the Persian 404 body is delivered in the RSC payload and hydrated on the client rather than in the initial HTML (unmatched URLs, e.g. `/some-unknown-path/`, are server-rendered in full).
- Dates (`faDate`) are pinned to `Asia/Tehran`: review dates are now server-rendered, and an unpinned timezone made the container's UTC calendar disagree with the browser's after midnight (a hydration mismatch).
- Recently viewed reads `localStorage` after hydration (not during the first render), so the server and the first client render agree.
- Daily deals and banners are read on **every** render (public, cookie-free, uncached): an owner edit appears immediately and the countdown's `server_now` base is never stale. Products, categories, brands and settings keep the 60-second public cache.
- Full document navigation between the two apps is intentional: `frontend/src/utils/nextRoutes.jsx` is the SPA's single switchboard, so links to `/`, `/shop/…`, `/products/…`, `/brands/…` leave the SPA instead of rendering its retired copies.

## Verification

- `npm run build`: passed; `/`, `/shop`, `/products/[slug]`, `/brands/[slug]` are dynamic (server-rendered on demand).
- `npm test`: 24 tests passed — shop HTML from query params, unchanged filter forwarding, `?page=N` paging, product HTML + IRR JSON-LD, real 404s (product and brand), canonicals, the uncached-deals/60s-products split, and the failed-API fallback.
- Live smoke test (`next start` + a fake Django + `curl`): `/shop/` 200, `/products/copper-pot/` 200, `/brands/mes-karan/` 200, `/products/unknown-product/` 404, `/brands/nope/` 404, `/shop` 308 → `/shop/`, title/canonical/OpenGraph/JSON-LD present in the HTML.
- `frontend`: `npm test` 697 tests passed (includes the new `nextRoutes` helper suite); two SPA tests that asserted in-app navigation to `/` were updated to assert the document-link contract.
- No lint configuration added. No Playwright, real browser, backend suite or Docker run in this workspace, so live Nginx/Compose validation remains a deployment check.
