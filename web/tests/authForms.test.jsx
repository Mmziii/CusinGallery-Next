// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ search: "", navigate: vi.fn(), login: vi.fn(), register: vi.fn(), confirmPasswordReset: vi.fn() }));
vi.mock("../lib/navigation", () => ({
  useNavigate: () => state.navigate,
  useLocation: () => ({ pathname: "/login/", search: state.search }),
  useSearchParams: () => [new URLSearchParams(state.search)],
  Navigate: () => null,
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
}));
vi.mock("../store/useAuthStore", () => ({ default: () => ({ login: state.login, register: state.register, isAuthenticated: false, isLoading: false }) }));
vi.mock("../services/authApi", () => ({ confirmPasswordReset: state.confirmPasswordReset }));
import LoginPage from "../auth/LoginPage";
import RegisterPage from "../auth/RegisterPage";
import PasswordResetConfirmPage from "../auth/PasswordResetConfirmPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, container;
function render(Page) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Page />));
}
function setValue(input, value) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => { container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
}
beforeEach(() => {
  state.search = "";
  state.navigate.mockReset();
  state.login.mockReset().mockResolvedValue({ success: true });
  state.register.mockReset().mockResolvedValue({ success: true });
  state.confirmPasswordReset.mockReset().mockResolvedValue({});
});
afterEach(() => {
  if (root) act(() => root.unmount());
  container?.remove();
});

for (const [name, Page] of [["login", LoginPage], ["register", RegisterPage]]) {
  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "/checkout/?step=delivery", "/cart/"])(`${name} success sanitizes next=%s`, async next => {
    state.search = `?next=${encodeURIComponent(next)}`;
    render(Page);
    if (name === "register") setValue(container.querySelector('input[type="tel"]'), "09123456789");
    await submit();
    const expected = next.startsWith("/checkout/") || next === "/cart/" ? next : "/";
    expect(state[name]).toHaveBeenCalledOnce();
    expect(state.navigate).toHaveBeenCalledWith(expected, { replace: true });
  });
}
it("login/register cross-links retain next", () => {
  state.search = "?next=%2Fcheckout%2F%3Fstep%3Ddelivery";
  render(LoginPage);
  expect(container.querySelector('a[href^="/register/"]').getAttribute("href")).toBe("/register/?next=%2Fcheckout%2F%3Fstep%3Ddelivery");
});
it("reset link posts the legacy uid/token contract unchanged", async () => {
  state.search = "?uid=sent-uid&token=sent-token";
  render(PasswordResetConfirmPage);
  const passwords = container.querySelectorAll('input[type="password"]');
  setValue(passwords[0], "New-password-123");
  setValue(passwords[1], "New-password-123");
  await submit();
  expect(state.confirmPasswordReset).toHaveBeenCalledWith({ uid: "sent-uid", token: "sent-token", new_password: "New-password-123", new_password_confirm: "New-password-123" });
});
it("reset SMS mode prefills phone and posts phone/code without uid/token", async () => {
  state.search = "?mode=code&phone=09123456789";
  render(PasswordResetConfirmPage);
  const code = container.querySelector('input[autocomplete="one-time-code"]');
  setValue(code, "123456");
  const passwords = container.querySelectorAll('input[type="password"]');
  setValue(passwords[0], "New-password-123");
  setValue(passwords[1], "New-password-123");
  await submit();
  expect(state.confirmPasswordReset).toHaveBeenCalledWith({ phone: "09123456789", code: "123456", new_password: "New-password-123", new_password_confirm: "New-password-123" });
});
