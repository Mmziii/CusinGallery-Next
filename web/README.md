# Phase 1: Next home page

JavaScript App Router, Next 16.4.2 (npm stable at implementation), standalone output. All dependencies/assets are local to `web/`; there are no imports from `frontend/`. The existing applications are unmodified.

## Files and boundaries

- `app/layout.js`: request-rendered Persian RTL document, inline owner theme from `/site/content/`, settings from `/site/settings/`, font preload and the original CSS import order.
- `app/page.js`, `home/Home.jsx`: server fetching/composition and original home markup.
- `home/HomeInteractive.jsx`: copied slider, countdown, coverflow/phone deals, reveal sections, product rows and reviews, receiving public server data.
- `components/`, `layouts/`, `hooks/`, `store/`, `services/`, `utils/`, `content/`: copied dependency tree, with Next routing and SSR adaptations. Header/footer/contact/toasts/analytics remain client components. CSRF initialization is retained.
- `lib/api-server.js`: internal Django requests, public Host/protocol forwarding, 60-second public fetch revalidation, pagination, explicit no-store private requests. Public requests never carry cookies. API failures preserve default site content and product-row retry UI.
- `lib/navigation.jsx`: Next links/router for home; ordinary anchors/document navigation for every not-yet-migrated page. NavLink active classes use `usePathname`.
- `lib/site-context.jsx`: server-provided settings/content for shared client components, avoiding a default-theme hydration flash.
- `lib/metadata.js`: home metadata and canonical origin.
- `styles/`, `public/fonts/`, `public/brand/`: unchanged copies. CSS, fonts and Zustand stores were checked byte-for-byte against the originals. Axios logic is unchanged except replacing the Vite environment expression with the relative `/api/v1` base URL.
- `Dockerfile`, `.dockerignore`, `next.config.mjs`, package/lock/config files: Node 22 Alpine multistage standalone build, non-root runtime on port 3000.
- `tests/phase1.test.jsx`: focused Node-only rendering/data tests; no browser.

## Routing and deployment

Both Compose files now include `web`. Nginx's actual storefront server and the production HTTP bootstrap example route **exactly `/`** and **`/_next/`** to `web:3000`. The production HTTP-to-HTTPS redirect is unchanged. All other locations, Django page-status validation, API/admin/payments, SPA assets, fonts, brand assets and media retain their old routing. Shared public assets are also copied into `web/public` for future migration, but their current Nginx routing is deliberately unchanged.

`HTTP_PORT` defaults to 80; `HTTPS_PORT` defaults to 443. Development's HTTPS mapping stays commented until TLS is configured, as before. Set these in the Compose environment to avoid host port collisions. This does not by itself configure certificates, domains, or redirect ports for a second deployment.

Runtime: `INTERNAL_API_URL=http://backend:8000`; `SITE_ORIGIN` is wired from the existing `VITE_SITE_ORIGIN` Compose variable (default `https://cusin.ir`). Django must allow the public Host. Analytics/error-reporting flags are wired as build arguments using `NEXT_PUBLIC_*` names. No internal backend address is sent to browser API calls.

```sh
cd web
npm ci
npm test
npm run build
```

Use Compose/Nginx for integrated local testing: a bare Next server does not proxy SPA pages or `/api`. No extra Next routes or catch-all proxy have been introduced.

## Parity notes / deliberate differences

- Original markup/classes, hero interactions, deals controls, countdown, reviews, brand tiles and add-to-cart logic are retained. Public data now arrives in server HTML instead of loading skeletons.
- The existing `SiteSettingsSerializer` has contact fields only: it exposes no home SEO title/description/OG fields. Until the backend gains those fields, metadata preserves `frontend/index.html` defaults (including its distinct document/OG descriptions and `/brand/og.png`), with owner brand name from site content and configurable canonical origin. Optional future SEO settings fields are supported; none were invented in Django.
- Recently viewed depends on browser localStorage, so it still loads after hydration. Private account/cart data also remains client-side and is never placed in public cache entries.
- Both phone and desktop deals/product-card variants are in the server HTML. The additive `styles/responsive-variants.css` selects them at 767px/768px using `display: none`, which also removes hidden controls from keyboard navigation and the accessibility tree. The four copied stylesheets remain unchanged. Media queries only control behaviour (desktop autoplay, visible countdown timers, toast wording); they never select variant markup. Desktop autoplay and rotation timers stop on phones, and hidden countdowns do not run interval timers. One shared expiry clock still removes expired deals from both variants. No browser-based pixel comparison was performed.
- A product-row API error retains the error markup, but its retry reloads the document to rerun server fetching rather than making the old in-component Axios request.
- Full document navigation to SPA pages is intentional during phase 1, so both applications keep their respective routers. SPA-to-home client-side navigation remains owned by the unchanged SPA until a full home request.

## Verification

- `npm run build`: passed; `/` is dynamically server-rendered, standalone output generated.
- `npm test`: 9 tests passed: server HTML products/prices/deals, theme inline on html, active navigation, Host/cache/private-cookie handling, pagination, metadata, failed API fallback, absolute API destination rejection, both responsive variants present in server HTML.
- `npm audit`: zero vulnerabilities.
- `git diff --check`: passed.
- CSS/fonts/stores: byte-identical comparison passed.
- No lint configuration added. No Playwright, real browser, or backend suite run. Docker is unavailable in this workspace, so image builds and live Nginx/Compose validation remain deployment checks.

`.npmrc` enables legacy peer resolution because the unchanged Zustand 4 dependency advertises React <=18 peers, while the latest Next uses React 19. The build and focused rendering tests pass; full interactive browser validation remains outstanding.
