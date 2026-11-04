"use client";
import PropTypes from "prop-types";

import { Link, useLocation } from "../lib/navigation";
import useAuthStore from "../store/useAuthStore";
import useCartStore from "../store/useCartStore";
import { faDigits } from "../utils/faDigits";
import Icon from "./Icon";

/**
 * Phone bottom tab bar (app-style): خانه / دسته‌ها / جستجو / سبد / حساب.
 *
 * Shown only below 768px (CSS) and only on routes without their own fixed
 * bottom bar: the product page (sticky buy bar), cart, checkout and payment
 * keep theirs, so `showBottomNav()` hides this one there. MainLayout uses the
 * same function to put `app-shell--tabbar` on the shell during SSR, which
 * hides the header's duplicate cart/account/search buttons on phones and
 * reserves room at the bottom -- no layout shift after hydration.
 *
 * «دسته‌ها»، «جستجو» and «سبد» drive the header's existing drawer, search
 * field and mini-cart through one window event, so there is still exactly
 * one menu, one search box and one mini-cart in the page.
 */
export const BOTTOM_NAV_EVENT = "cusin:bottom-nav";

const HIDDEN = /^\/(products\/[^/]+|cart|checkout|payment)(\/|$)/;

export function showBottomNav(pathname) {
  return !HIDDEN.test(pathname || "/");
}

function send(action) {
  window.dispatchEvent(new CustomEvent(BOTTOM_NAV_EVENT, { detail: { action } }));
}

function Tab({ label, icon, children }) {
  return (
    <>
      <Icon name={icon} size={22} />
      <span className="bottom-nav__label">{label}</span>
      {children}
    </>
  );
}

Tab.propTypes = {
  label: PropTypes.string.isRequired,
  icon: PropTypes.string.isRequired,
  children: PropTypes.node,
};

export default function BottomNav() {
  const { pathname } = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const itemCount = useCartStore((s) => s.cart?.item_count ?? 0);

  if (!showBottomNav(pathname)) return null;

  const path = (pathname || "/").replace(/\/$/, "") || "/";
  const isHome = path === "/";
  const isAccount = /^\/(account|login|register|wishlist)(\/|$)/.test(path);
  const accountHref = isAuthenticated ? "/account/" : "/login/";

  return (
    <nav className="bottom-nav" aria-label="ناوبری اصلی">
      <Link to="/" className="bottom-nav__item" aria-current={isHome ? "page" : undefined}>
        <Tab label="خانه" icon="home" />
      </Link>
      <button type="button" className="bottom-nav__item" onClick={() => send("menu")}>
        <Tab label="دسته‌ها" icon="grid" />
      </button>
      <button type="button" className="bottom-nav__item" onClick={() => send("search")}>
        <Tab label="جستجو" icon="search" />
      </button>
      <button
        type="button"
        className="bottom-nav__item"
        onClick={() => send("cart")}
        aria-label={`سبد خرید (${faDigits(itemCount)} قلم)`}
      >
        <Tab label="سبد" icon="bag">
          {itemCount > 0 ? (
            <span className="bottom-nav__badge" key={itemCount} aria-hidden="true">
              {faDigits(itemCount)}
            </span>
          ) : null}
        </Tab>
      </button>
      <Link to={accountHref} className="bottom-nav__item" aria-current={isAccount ? "page" : undefined}>
        <Tab label="حساب" icon="user" />
      </Link>
    </nav>
  );
}
