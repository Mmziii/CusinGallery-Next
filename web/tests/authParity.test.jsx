import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { safeNext, loginUrl } from "../lib/auth-navigation";

const { asyncState, router } = vi.hoisted(() => ({
  asyncState: { data: null, isLoading: false, error: { response: { status: 404, data: { detail: "یافت نشد." } } }, refetch: () => {} },
  router: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock("../hooks/useAsync", () => ({ useAsync: () => asyncState }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ orderId: "999" }), useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/account/orders/999/", useRouter: () => router,
}));
vi.mock("next/link", () => ({ default: ({ href, prefetch, children, ...rest }) => <a href={href} {...rest}>{children}</a> }));
import OrderDetailPage from "../auth/account/OrderDetailPage";
import { ErrorState, errorMessage } from "../components/ui";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
// NOTE (Phase 5): the pre-migration parity suites that diffed these pages
// against the retired Vite sources were removed with the retired Vite app; the pages
// below are the storefront now, and their markup is pinned by the HTTP
// tests (authHttp.test.jsx) instead.
it("another user's order (Django 404) renders the not-found/error view", () => {
  const html = renderToStaticMarkup(<OrderDetailPage />);
  const originalView = renderToStaticMarkup(<ErrorState message={errorMessage(asyncState.error)} onRetry={asyncState.refetch} />);
  expect(html).toBe(originalView);
  // The raw Axios error goes to errorMessage, whose fallback is
  // intentionally retained rather than replacing this with a new design.
  expect(html).toContain("خطایی رخ داد. دوباره تلاش کنید.");
});
it.each(["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "/\n/evil.com", "/\t/evil.com", ["/account/"]])("safeNext rejects %s", next => {
  expect(safeNext(next)).toBe("/");
});
it("login target uses a safe path and preserves original query order", () => {
  expect(loginUrl("/account/orders/?z=2&x=1")).toBe("/login/?next=%2Faccount%2Forders%2F%3Fz%3D2%26x%3D1");
  expect(loginUrl("//evil.com")).toBe("/login/?next=%2F");
});
it("all storefront paths are Next-owned; only Django paths stay document loads", async () => {
  const { isNextOwnedPath } = await import("../lib/navigation");
  for (const path of ["/login/", "/register/", "/password-reset/", "/reset-password/confirm/?uid=abc&token=def", "/account/orders/3/", "/wishlist/", "/cart/", "/checkout/?step=delivery", "/payment/result/", "/payment/result/42/", "/about/", "/contact/", "/shipping-returns/", "/terms/", "/privacy/", "/some/unknown/path/", "/about-x/", "/admin-guide/", "/api-docs/"]) expect(isNextOwnedPath(path)).toBe(true);
  for (const path of ["/admin/", "/api/v1/products/", "/payment/callback/", "/media/pot.jpg", "/static/admin/css/base.css"]) expect(isNextOwnedPath(path)).toBe(false);
});
it("no ported page selects responsive markup using window width or native confirm", () => {
  for (const name of ["LoginPage", "RegisterPage", "PasswordResetRequestPage", "PasswordResetConfirmPage", "WishlistPage", "account/AccountLayout", "account/ProfilePage", "account/OrdersPage", "account/OrderDetailPage", "account/AddressesPage", "account/ReviewsPage"]) {
    expect(read(`../auth/${name}.jsx`)).not.toMatch(/useMediaQuery|window\.(innerWidth|matchMedia|confirm)/);
  }
  for (const name of ["CartPage", "CheckoutPage", "PaymentResultPage"]) {
    expect(read(`../purchase/${name}.jsx`)).not.toMatch(/useMediaQuery|window\.(innerWidth|matchMedia|confirm)/);
  }
  expect(read("../info/InfoPage.jsx")).not.toMatch(/useMediaQuery|window\.(innerWidth|matchMedia|confirm)/);
});

it("storefront info and purchase routes use router push/replace while Django paths use window.location", async () => {
  const { useNavigate } = await import("../lib/navigation");
  const assign = vi.fn(), replace = vi.fn();
  vi.stubGlobal("window", { location: { assign, replace } });
  try {
    router.push.mockClear();
    router.replace.mockClear();
    const navigate = useNavigate();
    navigate(safeNext("/shipping-returns/"), { replace: true });
    expect(router.replace).toHaveBeenCalledWith("/shipping-returns/");
    navigate(safeNext("/about/"));
    expect(router.push).toHaveBeenCalledWith("/about/");
    navigate("/payment/callback/?Authority=A000");
    expect(assign).toHaveBeenCalledWith("/payment/callback/?Authority=A000");
  } finally { vi.unstubAllGlobals(); }
});
it.each(["conf.d/cusin.conf", "prod.d/cusin.conf", "prod.d/00-bootstrap-http.conf.example"])("nginx %s routes the storefront catch-all to Next and keeps Django API/admin/callback", file => {
  const text = read(`../../nginx/${file}`);
  // Phase 5: the per-route `location ~ ...` Next blocks were folded into
  // the catch-all (identical proxies), and the retired /seo/ block is gone.
  expect(text).not.toMatch(/location ~ \^\/(login|register|password-reset|reset-password|account|wishlist|cart|checkout|payment\/result|shop|products|brands)\//);
  expect(text).not.toContain("location /seo/ {");
  // The match skips the :80 redirect twin (no proxy_pass) and the
  // commented HTTPS example (no web:3000 there either).
  const catchAll = text.match(/location \/ \{[^}]*proxy_pass http:\/\/web:3000;[^}]*\}/)?.[0];
  expect(catchAll).toBeTruthy();
  for (const directive of ["proxy_pass http://web:3000;", "proxy_set_header Host $http_host;", "proxy_set_header X-Forwarded-Host $http_host;", "proxy_set_header X-Forwarded-Proto $scheme;", "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"]) expect(catchAll).toContain(directive);
  for (const route of ["/api/", "/admin/", "/payment/callback/"]) expect(text.split(`location ${route} {`)[1]?.split("}")[0]).toContain("backend_upstream");
});
