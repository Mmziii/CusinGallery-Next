import PropTypes from "prop-types";
import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Phase 4: every storefront route is now owned by the Next app, so the SPA
 * serves no page any more. Mirrors `web/lib/navigation.jsx`: `isNextOwnedPath`
 * is true for every storefront path and false only for Django/edge-owned paths
 * (`/admin/`, `/api/`, `/payment/callback/`, `/media/`, `/static/`) and
 * non-root-relative external URLs.
 *
 * Because neither Next-owned pages nor Django-owned endpoints live inside
 * react-router, every link/navigation here performs a full document navigation
 * (`<a href>` / `window.location`).
 */

export const DJANGO_OWNED_PREFIXES = [
  "/admin",
  "/api",
  "/payment/callback",
  "/media",
  "/static",
];

/** The href a `to` value resolves to (string or {pathname, search, hash}). */
export function nextHref(to) {
  if (typeof to === "string") return to;
  if (!to) return "/";
  return `${to.pathname || "/"}${to.search || ""}${to.hash || ""}`;
}

export function isDjangoOwnedPath(to) {
  const path = nextHref(to).split(/[?#]/)[0];
  return DJANGO_OWNED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`)
  );
}

/** True when the Next app owns this URL (every storefront path; excludes Django paths). */
export function isNextOwnedPath(to) {
  const path = nextHref(to).split(/[?#]/)[0];
  if (!path || path === "/") return true;
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  return !isDjangoOwnedPath(path);
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

/** <Link> that leaves the SPA via a document navigation. */
export function Link({ to, replace: _replace, className, children, ...props }) {
  const href = nextHref(to);
  return nextAnchor({ href, className, children, ...props });
}

/** <NavLink> that leaves the SPA via a document navigation (active state kept). */
export function NavLink({ to, end = false, className, children, ...props }) {
  const { pathname } = useLocation();
  const href = nextHref(to);
  return nextAnchor({
    href,
    isActive: isActiveHref(pathname, href, end),
    className,
    children,
    ...props,
  });
}

/** useNavigate() that leaves the SPA via window.location (numeric deltas stay on history). */
export function useNextNavigate() {
  const navigate = useNavigate();
  return useCallback(
    (to, options = {}) => {
      if (typeof to === "number") return navigate(to);
      const href = nextHref(to);
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
