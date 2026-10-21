// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ navigate: vi.fn(), fetchMe: vi.fn(), login: vi.fn(), mergeGuestCart: vi.fn(), fetchCart: vi.fn() }));
vi.mock("../lib/navigation", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: "/account/orders/", search: "?x=1" }),
}));
vi.mock("../services/authApi", () => ({ fetchMe: mocks.fetchMe, login: mocks.login }));
vi.mock("../store/useCartStore", () => ({ default: { getState: () => ({ mergeGuestCart: mocks.mergeGuestCart, fetchCart: mocks.fetchCart }) } }));
import useAuthStore, { AuthProvider } from "../store/useAuthStore";
import ProtectedRoute from "../components/ProtectedRoute";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, container;
const user = { id: 7, first_name: "کاربر" };
function render(initialUser, serverUser) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<AuthProvider user={initialUser}><ProtectedRoute serverUser={serverUser}><p>private page</p></ProtectedRoute></AuthProvider>));
}
beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});
afterEach(() => { if (root) act(() => root.unmount()); container?.remove(); });
it("a fresh server page probe seeds a persistent anonymous layout without a login bounce", () => {
  render(null, user);
  expect(container.textContent).toBe("private page");
  expect(useAuthStore.getState().user).toEqual(user);
  expect(mocks.navigate).not.toHaveBeenCalled();
});
it("unknown server status leaves the initial SPA checking-login spinner", () => {
  render(undefined, undefined);
  expect(container.textContent).toContain("در حال بررسی ورود…");
  expect(mocks.navigate).not.toHaveBeenCalled();
});
it("a failed client me-probe never clears an already known user", async () => {
  render(user, user);
  mocks.fetchMe.mockRejectedValue(new Error("Django unreachable"));
  await act(async () => { await useAuthStore.getState().fetchMe(); });
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
  expect(container.textContent).toBe("private page");
  expect(mocks.navigate).not.toHaveBeenCalled();
});
it("session-expired still downgrades the store and uses next=path+query", () => {
  render(user, user);
  act(() => window.dispatchEvent(new Event("auth:session-expired")));
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(mocks.navigate).toHaveBeenCalledWith("/login/?next=%2Faccount%2Forders%2F%3Fx%3D1", { replace: true });
});
it("successful login still merges the guest cart in the existing store", async () => {
  render(undefined, undefined);
  mocks.login.mockResolvedValue(user);
  mocks.mergeGuestCart.mockResolvedValue({ adjusted: [], skipped: [] });
  let result;
  await act(async () => { result = await useAuthStore.getState().login("09123456789", "password"); });
  expect(result).toEqual({ success: true });
  expect(mocks.login).toHaveBeenCalledWith({ identifier: "09123456789", password: "password" });
  expect(mocks.mergeGuestCart).toHaveBeenCalledOnce();
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
});
