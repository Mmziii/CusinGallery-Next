"use client";
import { useEffect } from "react";
import NextLink from "next/link";
import { usePathname, useSearchParams as useNextSearchParams, useRouter, useParams as nextUseParams } from "next/navigation";

/**
 * Link/router shim for the page-by-page migration.
 *
 * Routes the Next app renders (phases 1-3a: home, catalog, auth, account and wishlist) use the Next router; routes the old SPA still owns (cart,
 * checkout, payment result and info pages) must be FULL DOCUMENT
 * navigations, so they render a plain <a href>.
 */
const NEXT_OWNED_PREFIXES = ["/shop", "/products", "/brands", "/login", "/register", "/password-reset", "/reset-password", "/account", "/wishlist"];

const hrefFor = (to) => typeof to === "string" ? to : `${to.pathname || "/"}${to.search || ""}${to.hash || ""}`;

export function isNextOwnedPath(to) {
  const path = hrefFor(to).split(/[?#]/)[0];
  if (!path || path === "/") return true;
  return NEXT_OWNED_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// Unmigrated pages MUST be document navigations, not Next RSC requests.
export function Link({ to, children, ...props }) {
  const href = hrefFor(to);
  return isNextOwnedPath(href)
    ? <NextLink href={href} prefetch={false} {...props}>{children}</NextLink>
    : <a href={href} {...props}>{children}</a>;
}
export function NavLink({ to, end, className, children, ...props }) {
  const pathname = usePathname();
  const target = hrefFor(to).split(/[?#]/)[0].replace(/\/$/, "") || "/";
  const current = pathname.replace(/\/$/, "") || "/";
  const isActive = current === target || (!end && target !== "/" && current.startsWith(`${target}/`));
  return <Link to={to} aria-current={isActive ? "page" : undefined} className={typeof className === "function" ? className({ isActive }) : [className, isActive && "active"].filter(Boolean).join(" ")} {...props}>{typeof children === "function" ? children({ isActive }) : children}</Link>;
}
export function useLocation() {
  const pathname = usePathname();
  const params = useNextSearchParams();
  return { pathname, search: params.toString() ? `?${params}` : "", hash: "" };
}
export function useNavigate() {
  const router = useRouter();
  return (to, options = {}) => {
    if (typeof to === "number") return window.history.go(to);
    const href = hrefFor(to);
    if (isNextOwnedPath(href)) return options.replace ? router.replace(href) : router.push(href);
    return options.replace ? window.location.replace(href) : window.location.assign(href);
  };
}

export const useParams = () => nextUseParams();
export function useSearchParams() { return [useNextSearchParams()]; }
export function Navigate({ to, replace }) {
  const navigate = useNavigate();
  useEffect(() => { navigate(to, { replace }); }, [to, replace]);
  return null;
}
