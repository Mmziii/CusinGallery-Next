import PropTypes from "prop-types";
import { useEffect } from "react";
import { useLocation } from "react-router-dom";

import useAuthStore from "../store/useAuthStore";
import { Spinner } from "./ui";

/**
 * Wraps authenticated-only routes. Waits for the initial /me/ probe to
 * finish before deciding anything, so a logged-in user refreshing the
 * page is never bounced through /login/ for a moment.
 */
function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  const location = useLocation();

  const target = `/login/?next=${encodeURIComponent(location.pathname + location.search)}`;
  useEffect(() => {
    if (!isLoading && !isAuthenticated) window.location.replace(target);
  }, [isLoading, isAuthenticated, target]);

  if (isLoading) {
    return <Spinner label="در حال بررسی ورود…" />;
  }

  if (!isAuthenticated) {
    return null;
  }

  return children;
}

ProtectedRoute.propTypes = { children: PropTypes.node.isRequired };

export default ProtectedRoute;
