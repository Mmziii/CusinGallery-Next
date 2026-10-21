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
- `lib/django-request.js`: the `node:http(s)` request itself (Host/`X-Forwarded-*` forwarding, timeout, status on the error), shared by the API client and `proxy.js` — the API client reads `next/headers`, which the proxy runtime does not have.
- `proxy.js`: the not-found shim for `/products/<slug>/` and `/brands/<slug>/`. It asks Django whether the slug exists (60-second cache, one request per slug per minute, fail-open) and, when it does not, rewrites to `/not-found-page/` with `status: 404`, so the Persian 404 and the site chrome are in the first response (see the 404 note below).
- `app/not-found-page/page.js`: that rewrite target — the same `NotFoundPage` component as `app/not-found.js`, rendered through the normal root layout and marked `noindex, nofollow`.
- `lib/catalog-server.js`: shop/product/brand reads, the shop's parameter whitelist (`attr_*` facets included) and facet scoping. Paging is **standard pagination**: `?page=N` renders page N with exactly ONE listing request. An invalid `?page=` (`abc`, `0`, `-2`, `3.5`) 308s to the same URL without the parameter before any request; a page past the last one 308s to the real last page, resolved from `count` with at most one extra (page-1) request.
- `utils/shopPaging.js`: the page contract shared by the server and the browser — `readShopPage`, `shopHref` (page 1 = the page-less URL), `totalPages`, `pageWindow`. No imports, so the client island can use it without pulling in `node:http`.
- `lib/jsonld.js`, `lib/metadata.js`, `lib/site.js`: structured data (Product with IRR prices, BreadcrumbList, WebSite, Organization), titles/descriptions/canonical/OpenGraph, canonical origin.
- `lib/navigation.jsx`: Next links/router for pages this app renders; ordinary anchors/document navigation for every route the SPA still owns.
- `styles/`: the SPA's stylesheets plus the additive `responsive-variants.css`, which is the ONLY place viewport width selects between the two server-rendered variants. One deliberate difference from the SPA copy: the `.shop__load-more` hide rule in `storefront.css` is scoped to `@media (min-width: 768px)` — written unconditionally it came after the phone rule and hid the phone pager (`tests/responsiveCss.test.jsx`).
- `tests/phase1.test.jsx`, `tests/phase2.test.jsx`, `tests/api-server.test.jsx`, `tests/catalogAvailability.test.jsx`: Node-only tests against a real throwaway `node:http` Django stand-in.
- `tests/responsiveCss.test.jsx` (+ `tests/helpers/cssCascade.js`): CSS-contract tests that read the stylesheets in the layout's import order, resolve the cascade at a given viewport width, and fail if any later rule re-hides a phone control.
- `tests/notFoundSsr.test.jsx`: the 404 contract — the proxy keeps `404` and rewrites to `/not-found-page/`, fails open when Django cannot answer, leaves RSC navigations alone, and the 404 document renders the Persian text inside the header/footer shell.

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
- Unknown product/brand slugs are a **server-rendered 404**. `notFound()` alone is not enough on Next 16.4: it answers 404 with an empty document (React runs no error boundaries while server rendering, so the throw escapes the Fizz shell and the recovery render seeds Next's `__next_error__` document — vercel/next.js#99287). `proxy.js` therefore checks the slug against Django first and rewrites misses to `/not-found-page/` with the 404 status kept: the response carries `<html lang="fa" dir="rtl">`, the header, the footer, the Persian 404 and `noindex` in the first HTML, with no JavaScript. Unmatched URLs (`/some-unknown-path/`) already render `app/not-found.js` in full; client-side (RSC) navigations to a dead slug keep using the framework boundary, which renders after hydration.
- Dates (`faDate`) are pinned to `Asia/Tehran`: review dates are now server-rendered, and an unpinned timezone made the container's UTC calendar disagree with the browser's after midnight (a hydration mismatch).
- Recently viewed reads `localStorage` after hydration (not during the first render), so the server and the first client render agree.
- Daily deals and banners are read on **every** render (public, cookie-free, uncached): an owner edit appears immediately and the countdown's `server_now` base is never stale. Products, categories, brands and settings keep the 60-second public cache.
- Full document navigation between the two apps is intentional: `frontend/src/utils/nextRoutes.jsx` is the SPA's single switchboard, so links to `/`, `/shop/…`, `/products/…`, `/brands/…` leave the SPA instead of rendering its retired copies.

## Verification

- `npm run build`: passed; `/`, `/shop`, `/products/[slug]`, `/brands/[slug]`, `/not-found-page` are dynamic (server-rendered on demand) and `proxy.js` builds as `ƒ Proxy (Middleware)`.
- `npm test`: 55 tests passed (7 files) — shop HTML from query params, unchanged filter forwarding, standard pagination (`?page=3` = items 41-60 with ONE listing request, `?page=8` = 141-160, `?page=99` → 308 to page 8 with one extra request, invalid `?page` → 308 with none), product HTML + IRR JSON-LD, real 404s (product and brand), canonicals + `noindex, follow` + `rel=prev/next` on paged listings, the uncached-deals/60s-products split, the failed-API fallback, and a jsdom suite for the phone's «نمایش کالاهای بیشتر» (requests page N+1 with the same filters through the client API, appends into its own grid, rewrites the URL with replaceState, hides itself on `next: null`, drops an in-flight page when the filters change). The phase-2 live fixes added three suites: the load-more/pager CSS contract resolved at 320-1440px (it fails if any later rule re-hides a phone control), the proxy's 404 contract (rewrite + status, fail-open on upstream errors, RSC passthrough) with the 404 document rendered inside the header/footer shell, and the real-HTTP slug check (Host forwarding, 404 vs 500/timeout, one lookup per minute, single-flight).
- Live smoke test (`next start` + a fake Django of 160 products + `curl`): `/shop/` 200, `/products/copper-pot/` 200, `/brands/mes-karan/` 200, `/products/unknown-product/` 404, `/brands/nope/` 404, `/shop` 308 → `/shop/`, title/canonical/OpenGraph/JSON-LD present in the HTML. The unknown-slug 404s are now **full documents**: status 404, `<html lang="fa" dir="rtl">`, `class="app-shell"`/`site-header`/`site-footer`, the Persian 404 (`class="notfound"`, «۴۰۴», «صفحه مورد نظر پیدا نشد») and «یافت نشد» in `<title>` — all without JavaScript (checked by curling the body and ignoring the RSC payload). `?page=3` carries exactly products 41-60 and `?page=8` exactly 141-160, one listing request each; `/shop/?page=99` → 308 `/shop/?page=8` and `/brands/mes-karan/?page=77` → 308 `/brands/mes-karan/?page=8` (one page-1 request for `count`); `/shop/?page=abc` → 308 `/shop/` with no upstream call; paged HTML carries `<meta name="robots" content="noindex, follow">`, the page-less canonical, and `rel="prev"/"next"`.
- `frontend`: `npm test` 697 tests passed (includes the new `nextRoutes` helper suite); two SPA tests that asserted in-app navigation to `/` were updated to assert the document-link contract.
- No lint configuration added. No Playwright, real browser, backend suite or Docker run in this workspace, so live Nginx/Compose validation remains a deployment check.
