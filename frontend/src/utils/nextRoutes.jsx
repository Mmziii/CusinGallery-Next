import PropTypes from "prop-types";
import { useCallback } from "react";
import {
  Link as RouterLink,
  NavLink as RouterNavLink,
  useLocation,
  useNavigate,
} from "react-router-dom";

/**
 * The storefront is being migrated page by page to the Next app; the SPA still
 * owns cart, checkout, account, auth and the info pages. This is the ONE
 * switchboard between them.
 *
 * Links into a Next-owned route must be a FULL DOCUMENT NAVIGATION (a plain
 * <a href>), not a react-router transition: react-router would render the
 * SPA's own old copy of that page -- this is how clicking the logo on an SPA
 * page used to land on the retired SPA home instead of the Next one. Links
 * into SPA-owned routes keep using react-router exactly as before.
 *
 * Drop-in replacements -- import { Link, NavLink, useNextNavigate } from here
 * instead of from "react-router-dom" anywhere a Next-owned URL can be
 * produced.
 */

//: Route prefixes rendered by the Next app (phases 1-2).
const NEXT_OWNED_PREFIXES = ["/shop", "/products", "/brands"];

/** The href a `to` value resolves to (string or {pathname, search, hash}). */
export function nextHref(to) {
  if (typeof to === "string") return to;
  if (!to) return "/";
  return `${to.pathname || "/"}${to.search || ""}${to.hash || ""}`;
}

/** True when the Next app owns this URL (so it must be a document load). */
export function isNextOwnedPath(to) {
  const path = nextHref(to).split(/[?#]/)[0];
  if (!path || path === "/") return true;
  return NEXT_OWNED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

/** react-router's own NavLink matching, minus the router transition. */
function isActiveHref(pathname, href, end) {
  const target = href.split(/[?#]/)[0].replace(/\/$/, "") || "/";
  const current = String(pathname || "/").replace(/\/$/, "") || "/";
  if (current === target) return true;
  if (end) return false;
  return target !== "/" && current.startsWith(`${target}/`);
}

function nextAnchor({ href, isActive = false, className, children, ...props }) {
  const state = { isActive, isPending: false, isTransitioning: false };
  const resolved = typeof className === "function" ? className(state) : className;
  return (
    <a
      href={href}
      aria-current={isActive ? "page" : undefined}
      {...(resolved ? { className: resolved } : {})}
      {...props}
    >
      {typeof children === "function" ? children(state) : children}
    </a>
  );
}

/** <Link> that leaves the SPA for Next-owned URLs. */
export function Link({ to, replace, className, children, ...props }) {
  const href = nextHref(to);
  if (!isNextOwnedPath(href)) {
    return (
      <RouterLink to={to} replace={replace} className={className} {...props}>
        {children}
      </RouterLink>
    );
  }
  return nextAnchor({ href, className, children, ...props });
}

/** <NavLink> that leaves the SPA for Next-owned URLs (active state kept). */
export function NavLink({ to, end = false, className, children, ...props }) {
  const { pathname } = useLocation();
  const href = nextHref(to);
  if (!isNextOwnedPath(href)) {
    return (
      <RouterNavLink to={to} end={end} className={className} {...props}>
        {children}
      </RouterNavLink>
    );
  }
  return nextAnchor({
    href,
    isActive: isActiveHref(pathname, href, end),
    className,
    children,
    ...props,
  });
}

/** useNavigate() that leaves the SPA for Next-owned URLs. */
export function useNextNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (to, options = {}) => {
      if (typeof to === "number") return navigate(to);
      const href = nextHref(to);
      if (!isNextOwnedPath(href)) return navigate(to, options);
      if (typeof window === "undefined") return undefined;
      if (options.replace) window.location.replace(href);
      else window.location.assign(href);
      return undefined;
    },
    [navigate]
  );
}

const toShape = PropTypes.oneOfType([PropTypes.string, PropTypes.object]);
Link.propTypes = {
  to: toShape.isRequired,
  replace: PropTypes.bool,
  children: PropTypes.node,
  className: PropTypes.oneOfType([PropTypes.string, PropTypes.func]),
};
NavLink.propTypes = {
  to: toShape.isRequired,
  end: PropTypes.bool,
  children: PropTypes.oneOfType([PropTypes.node, PropTypes.func]),
  className: PropTypes.oneOfType([PropTypes.string, PropTypes.func]),
};
