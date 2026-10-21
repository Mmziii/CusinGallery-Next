import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import { safeNext, loginUrl } from "../lib/auth-navigation";

const { asyncState } = vi.hoisted(() => ({ asyncState: { data: null, isLoading: false, error: { response: { status: 404, data: { detail: "یافت نشد." } } }, refetch: () => {} } }));
vi.mock("../hooks/useAsync", () => ({ useAsync: () => asyncState }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ orderId: "999" }), useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/account/orders/999/", useRouter: () => ({ push() {}, replace() {} }),
}));
vi.mock("next/link", () => ({ default: ({ href, prefetch, children, ...rest }) => <a href={href} {...rest}>{children}</a> }));
import OrderDetailPage from "../auth/account/OrderDetailPage";
import { ErrorState, errorMessage } from "../components/ui";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
function normalize(source) {
  return source.replace(/^"use client";\n/, "")
    .replace(/import \{ usePageMeta \} from [^;]+;\n/g, "")
    .replace(/^  usePageMeta\([^\n]+\);\n/gm, "")
    .replace(/from "(?:\.\.\/)+lib\/navigation"/g, 'from "react-router-dom"');
}
it.each(["PasswordResetRequestPage", "PasswordResetConfirmPage", "WishlistPage", "account/ProfilePage", "account/OrdersPage", "account/OrderDetailPage", "account/AddressesPage", "account/ReviewsPage"])("%s retains EXACT SPA markup, texts and behavior except routing/metadata", name => {
  expect(normalize(read(`../auth/${name}.jsx`))).toBe(normalize(read(`../../frontend/src/pages/${name}.jsx`)));
});
it.each(["PasswordInput", "PasswordHint", "AddressForm", "ConfirmDialog", "SearchCombobox"])("%s is the original SPA component", name => {
  expect(normalize(read(`../components/${name}.jsx`))).toBe(normalize(read(`../../frontend/src/components/${name}.jsx`)));
});
it("another user's order (Django 404) renders the same SPA not-found/error view", () => {
  const html = renderToStaticMarkup(<OrderDetailPage />);
  const originalView = renderToStaticMarkup(<ErrorState message={errorMessage(asyncState.error)} onRetry={asyncState.refetch} />);
  expect(html).toBe(originalView);
  // The SPA passes the raw Axios error to errorMessage, whose fallback is
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
it("new Next route prefixes have segment boundaries; SPA cart/checkout stay document loads", async () => {
  const { isNextOwnedPath } = await import("../lib/navigation");
  for (const path of ["/login/", "/register/", "/password-reset/", "/reset-password/confirm/?uid=abc&token=def", "/account/orders/3/", "/wishlist/"]) expect(isNextOwnedPath(path)).toBe(true);
  for (const path of ["/cart/", "/checkout/?step=delivery", "/payment/result/", "/accounting/", "/login-other/"]) expect(isNextOwnedPath(path)).toBe(false);
});
it("no ported page selects responsive markup using window width or native confirm", () => {
  for (const name of ["LoginPage", "RegisterPage", "PasswordResetRequestPage", "PasswordResetConfirmPage", "WishlistPage", "account/AccountLayout", "account/ProfilePage", "account/OrdersPage", "account/OrderDetailPage", "account/AddressesPage", "account/ReviewsPage"]) {
    expect(read(`../auth/${name}.jsx`)).not.toMatch(/useMediaQuery|window\.(innerWidth|matchMedia|confirm)/);
  }
});

it("next to SPA checkout/cart is a full document navigation, not a Next router push", async () => {
  const { useNavigate } = await import("../lib/navigation");
  const assign = vi.fn(), replace = vi.fn();
  vi.stubGlobal("window", { location: { assign, replace } });
  try {
    const navigate = useNavigate();
    navigate(safeNext("/checkout/?step=delivery"), { replace: true });
    expect(replace).toHaveBeenCalledWith("/checkout/?step=delivery");
    navigate(safeNext("/cart/"));
    expect(assign).toHaveBeenCalledWith("/cart/");
  } finally { vi.unstubAllGlobals(); }
});
it.each(["conf.d/cusin.conf", "prod.d/cusin.conf", "prod.d/00-bootstrap-http.conf.example"])("nginx %s routes phase 3a to Next and keeps Django API/admin/callback", file => {
  const text = read(`../../nginx/${file}`);
  for (const route of ["^/login/?$", "^/register/?$", "^/password-reset/?$", "^/reset-password(?:/.*)?$", "^/account(?:/.*)?$", "^/wishlist/?$"]) {
    const body = text.split(`location ~ ${route} {`)[1]?.split("}")[0];
    expect(body).toBeTruthy();
    for (const directive of ["proxy_pass http://web:3000;", "proxy_set_header Host $http_host;", "proxy_set_header X-Forwarded-Host $http_host;", "proxy_set_header X-Forwarded-Proto $scheme;", "proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"]) expect(body).toContain(directive);
  }
  for (const route of ["/api/", "/admin/", "/payment/callback/"]) expect(text.split(`location ${route} {`)[1]?.split("}")[0]).toContain("backend_upstream");
});
