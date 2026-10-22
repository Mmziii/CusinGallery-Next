"use client";
import { useCallback, useEffect, useRef } from "react";
import NextLink from "next/link";
import { usePathname, useSearchParams as useNextSearchParams, useRouter, useParams as nextUseParams } from "next/navigation";

/**
 * Link/router shim for the page-by-page migration.
 *
 * Routes the Next app renders (phases 1-3b: home, catalog, auth, account,
 * wishlist, cart, checkout and payment result) use the Next router; routes the
 * old SPA still owns (static info pages and unknown-path 404) plus Django
 * callbacks (/payment/callback/) must be FULL DOCUMENT navigations, so they
 * render a plain <a href>.
 */
const NEXT_OWNED_PREFIXES = [
  "/shop",
  "/products",
  "/brands",
  "/login",
  "/register",
  "/password-reset",
  "/reset-password",
  "/account",
  "/wishlist",
  "/cart",
  "/checkout",
  "/payment",
];

const hrefFor = (to) => typeof to === "string" ? to : `${to.pathname || "/"}${to.search || ""}${to.hash || ""}`;

export function isNextOwnedPath(to) {
  const path = hrefFor(to).split(/[?#]/)[0];
  if (!path || path === "/") return true;
  if (path === "/payment/callback" || path.startsWith("/payment/callback/")) return false;
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

export function useSearchParams() {
  const pathname = usePathname() || "/";
  const params = useNextSearchParams();
  const raw = params?.toString() || "";
  const queryRef = useRef({ pathname, raw });
  queryRef.current = { pathname, raw };

  const setSearchParams = useCallback((nextInit, options = {}) => {
    const { pathname: currentPath, raw: currentRaw } = queryRef.current;
    const prev = new URLSearchParams(currentRaw);
    const resolved = typeof nextInit === "function" ? nextInit(prev) : nextInit;
    const next =
      resolved instanceof URLSearchParams
        ? resolved
        : typeof resolved === "string"
          ? new URLSearchParams(resolved)
          : new URLSearchParams(
              Object.entries(resolved || {}).filter(([, v]) => v !== undefined && v !== null)
            );
    const query = next.toString();
    if (query === currentRaw) return;
    queryRef.current = { pathname: currentPath, raw: query };
    const url = `${currentPath}${query ? `?${query}` : ""}`;
    if (options.replace) {
      window.history.replaceState(null, "", url);
    } else {
      window.history.pushState(null, "", url);
    }
  }, []);

  return [new URLSearchParams(raw), setSearchParams];
}

export function Navigate({ to, replace }) {
  const navigate = useNavigate();
  useEffect(() => { navigate(to, { replace }); }, [to, replace]);
  return null;
}
