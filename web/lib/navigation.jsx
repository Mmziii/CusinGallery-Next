"use client";
import NextLink from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";

/**
 * Link/router shim for the page-by-page migration.
 *
 * Routes the Next app renders (phases 1-2: home, the shop listing, product and
 * brand pages) use the Next router; routes the old SPA still owns (cart,
 * checkout, account, auth, info pages, wishlist) must be FULL DOCUMENT
 * navigations, so they render a plain <a href>.
 */
const NEXT_OWNED_PREFIXES = ["/shop", "/products", "/brands"];

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
  const params = useSearchParams();
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
