# Cusin Gallery storefront (Next.js)

JavaScript App Router, Next 16.4.2, standalone output. This is the
storefront: every page is server-rendered here. API, admin, payment
callbacks, `/healthz`, `/robots.txt` and `/sitemap.xml` remain Django.

## Develop, build, test

```sh
cd web
npm ci
npm run dev    # Next dev server on :3000
npm run build  # production build (also what the web image runs)
npm test       # vitest suites (run the build first: see Verification)
```

Runtime env (see the repo-root `.env.example` and `docker-compose*.yml`):

| Variable | Purpose |
|---|---|
| `INTERNAL_API_URL` | Django base URL for server-side reads (`http://backend:8000` in compose, `http://localhost:8000` for local dev). |
| `SITE_ORIGIN` (or `NEXT_PUBLIC_SITE_ORIGIN`) | Canonical public origin, default `https://cusin.ir`. |
| `NEXT_PUBLIC_ANALYTICS_SCRIPT_URL` / `NEXT_PUBLIC_ANALYTICS_SITE_ID` | Optional analytics snippet (build-time); both empty = nothing loads. |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional storefront error reporting (build-time); empty = the browser sends nothing. |

## Routes

| Route | Source |
|---|---|
| `/` | `app/page.js` + `home/Home.jsx` |
| `/shop/` (with `?category=`, `?brand=`, `?search=`, `?min_price=`, `?max_price=`, `?in_stock=`, `?on_sale=`, `?ordering=`, `?page=`, `?attr_<slug>=`) | `app/shop/page.js` + `shop/ShopView.jsx` |
| `/products/<slug>/` | `app/products/[slug]/page.js` + `product/ProductDetail.jsx` |
| `/brands/<slug>/` | `app/brands/[slug]/page.js` (same listing view, brand-scoped) |
| `/login/`, `/register/`, `/password-reset/`, `/reset-password/confirm/` | `app/` server gates + `auth/` client forms |
| `/account/`, `/account/orders/`, `/account/orders/<id>/`, `/account/addresses/`, `/account/reviews/` | `app/account/` + `auth/account/` |
| `/wishlist/` | `app/wishlist/` + `auth/WishlistPage.jsx` |
| `/cart/`, `/checkout/`, `/payment/result/` | `app/` + `purchase/` |
| `/about/`, `/contact/`, `/shipping-returns/`, `/terms/`, `/privacy/` | `app/` + `info/` (owner-editable rows in Django) |

## Files and boundaries

- `app/layout.js`: request-rendered Persian RTL document, owner theme
  applied before the first paint, font preload and the CSS import order.
- `app/shop/page.js`, `app/products/[slug]/page.js`, `app/brands/[slug]/page.js`: catalog server components — query parsing, Django reads, metadata, JSON-LD, `notFound()`.
- `shop/ShopView.jsx`: the shop markup and behaviour as a client island (filter panel, phone sheets, sticky bar, sorting, paging) fed by server data.
- `product/ProductDetail.jsx`, `product/ReviewsSection.jsx`: product page; reviews summary + first page arrive server-rendered, the form/pagination stay client-side.
- `components/`: `Breadcrumbs`, `CategoryFilterTree`, `BrandFilter`, `PriceRangeFilter`, `ProductGallery`, `ProductLightbox`, `JsonLd`, `NotFoundPage`, header/footer, toaster, skeletons.
- `lib/api-server.js`: internal Django requests over `node:http` (never `fetch`: undici drops the Host header and Django answers `DisallowedHost`), public Host/protocol forwarding, 60-second public cache for catalog data, `privateData` (cookie, uncached) and `noCache` (public, uncached) modes. Errors carry `status` so a 404 becomes a real not-found page.
- `lib/django-request.js`: the `node:http(s)` request itself (Host/`X-Forwarded-*` forwarding, timeout, status on the error), shared by the API client and `proxy.js` — the API client reads `next/headers`, which the proxy runtime does not have.
- `proxy.js`: the not-found shim for `/products/<slug>/`, `/brands/<slug>/` and the info pages. It asks Django whether the slug/page exists (60-second cache, one request per slug per minute, fail-open) and, when it does not, rewrites to `/_not-found/` with `status: 404`, so the Persian 404 and the site chrome are in the first response (see the 404 note below). It also stamps private/auth routes with `Cache-Control: private, no-store` and `X-Robots-Tag: noindex, follow`.
- `lib/catalog-server.js`: shop/product/brand reads, the shop's parameter whitelist (`attr_*` facets included) and facet scoping. Paging is **standard pagination**: `?page=N` renders page N with exactly ONE listing request. An invalid `?page=` (`abc`, `0`, `-2`, `3.5`) 308s to the same URL without the parameter before any request; a page past the last one 308s to the real last page, resolved from `count` with at most one extra (page-1) request.
- `utils/shopPaging.js`: the page contract shared by the server and the browser — `readShopPage`, `shopHref` (page 1 = the page-less URL), `totalPages`, `pageWindow`. No imports, so the client island can use it without pulling in `node:http`.
- `lib/info-server.js`, `info/`: owner-editable info pages — server reads, `InfoPageRoute` composition, the same error/empty states as the rest of the shop.
- `lib/jsonld.js`, `lib/metadata.js`, `lib/site.js`: structured data (Product with IRR prices, BreadcrumbList, WebSite, Organization), titles/descriptions/canonical/OpenGraph, canonical origin.
- `lib/navigation.jsx`: Next links/router for storefront paths; ordinary anchors/document navigation only for Django-owned prefixes (`/admin`, `/api`, `/payment/callback`, `/media`, `/static`) and external URLs.
- `styles/`: the storefront stylesheets plus the additive `responsive-variants.css`, which is the ONLY place viewport width selects between the two server-rendered variants.
- `public/`: files Next serves itself at the site root — `/fonts/` (self-hosted Vazirmatn), `/brand/` (logos, share images), `/favicon.svg`, `/favicon.ico`. No nginx locations proxy them; they arrive through the catch-all.

## Routing and deployment

Nginx (all three configs: `nginx/conf.d/cusin.conf`, `nginx/prod.d/cusin.conf`, `nginx/prod.d/00-bootstrap-http.conf.example`) sends everything that is not a Django path, `/static/` or `/media/` to `web:3000` through a single `location /` catch-all with `Host $http_host` and the `X-Forwarded-*` chain. `/api/`, `/admin/`, `/payment/callback/`, `/healthz`, `/robots.txt` and `/sitemap.xml` stay on Django. Next serves real HTML to bots and humans alike, so there are no crawler-only rewrites.

`next.config.mjs` sets `trailingSlash: true`, so `/shop/`, `/products/<slug>/` and `/brands/<slug>/` keep the exact URL shape the storefront always had (old links, the Django sitemap and the canonicals stay valid); `/shop` 308-redirects to `/shop/`.

## Behaviour notes / deliberate differences

- **Complements are intentionally not rendered**: the API's `complements` rows never appear; the product page renders `related_products` only.
- Prices: the page shows whole Toman; the JSON-LD `Offer` publishes Rial (`Toman × 10`) with `priceCurrency: "IRR"`.
- `og:type` is `website` on product pages. Next validates the OpenGraph type against its own enum and `product` is not part of it (it throws and the whole metadata object is dropped); the product signal lives in the JSON-LD `Product` instead.
- Unknown product/brand slugs and unpublished info pages are a **server-rendered 404**. `notFound()` alone is not enough on Next 16.4: it answers 404 with an empty document (React runs no error boundaries while server rendering, so the throw escapes the Fizz shell and the recovery render seeds Next's `__next_error__` document — vercel/next.js#99287). `proxy.js` therefore checks the slug against Django first and rewrites misses to `/_not-found/` with the 404 status kept: the response carries `<html lang="fa" dir="rtl">`, the header, the footer, the Persian 404 and `noindex` in the first HTML, with no JavaScript. Unmatched URLs (`/some-unknown-path/`) render `app/not-found.js` in full; client-side (RSC) navigations to a dead slug keep using the framework boundary, which renders after hydration.
- Dates (`faDate`) are pinned to `Asia/Tehran`: review dates are server-rendered, and an unpinned timezone made the container's UTC calendar disagree with the browser's after midnight (a hydration mismatch).
- Recently viewed reads `localStorage` after hydration (not during the first render), so the server and the first client render agree.
- Daily deals and banners are read on **every** render (public, cookie-free, uncached): an owner edit appears immediately and the countdown's `server_now` base is never stale. Products, categories, brands and settings keep the 60-second public cache.
- Responsive markup: nothing is chosen by `useMediaQuery`/window width except toast wording. The filter sidebar and the phone toolbar, the product `<section>`s and phone `<details>` accordions, and both product-card variants are all in the HTML; `styles/responsive-variants.css` + the existing breakpoints pick one with `display: none`, which also removes the hidden copy from the tab order.

## Auth/private boundaries

- Every protected page calls `requireUser()` in its server component; this uses
  `apiServer("/api/v1/accounts/me/", { privateData: true })`. The `React.cache`
  wrapper deduplicates only inside a render (root header + page). It is **not**
  a shared cache. Cookies never enter `unstable_cache`.
- Confirmed anonymous visitors get a 307 to `/login/?next=<path+query>`;
  unreachable Django is unknown, not anonymous, so the page renders and its
  client guard decides. Client me-probe failures preserve an already known user.
- `proxy.js` overwrites the internal original-URL header (including raw search),
  and sets `Cache-Control: private, no-store` plus `X-Robots-Tag: noindex, follow`
  for auth/account/wishlist routes. All new pages are force-dynamic with matching
  robots metadata. Page-specific data stays client-side with skeletons.
- `AuthProvider` creates a per-request store initialized **before** SSR (Zustand
  reads initial state for its server snapshot). No user is written to a global
  server store. This gives protected documents their account header on first
  paint; page probes also seed the persistent client layout before paint.
- Login/register share `safeNext`: single leading slash, no backslash/control
  characters, same-origin URL only; invalid next falls back to `/`. Successful
  login and registration keep cart merging and navigate with the Next router.
- Reset email links keep `?uid=...&token=...`; SMS keeps
  `?mode=code&phone=...` and the original request payloads.

## Verification

```sh
cd web
npm run build && npm test
```

Run **build before tests**: the `*Http.test.jsx` suites start production
Next (`next start`) against a real `node:http` fake Django, and shut both
down afterwards. No browser, backend suite or Docker run is required. The
remaining suites cover server rendering, shop paging, the proxy's 404
contract, auth guards/forms, purchase flows, responsive CSS and the nginx
routing expectations. No Playwright, real browser, backend suite or Docker
run in this workspace, so live Nginx/Compose validation remains a
deployment check.
