"use client";
import { useEffect, useLayoutEffect } from "react";
import { useLocation, useNavigate } from "../lib/navigation";
import { loginUrl } from "../lib/auth-navigation";
import useAuthStore from "../store/useAuthStore";
import { Spinner } from "./ui";

export default function ProtectedRoute({ children, serverUser }) {
  const { isAuthenticated, isLoading } = useAuthStore();
  // Root layouts persist during Next navigation. Seed fresh page probes too,
  // before paint, without ever writing a server user's data to a global store.
  useLayoutEffect(() => {
    if (serverUser) useAuthStore.setState({ user: serverUser, isAuthenticated: true, isLoading: false, error: null });
  }, [serverUser]);
  const location = useLocation();
  const navigate = useNavigate();
  const target = loginUrl(location.pathname + location.search);
  useEffect(() => {
    // A layout-effect seed may have superseded this render's snapshot.
    const current = useAuthStore.getState();
    if (!current.isLoading && !current.isAuthenticated) navigate(target, { replace: true });
  }, [isLoading, isAuthenticated, target]);
  if (isLoading) return <Spinner label="در حال بررسی ورود…" />;
  if (!isAuthenticated) return null;
  return children;
}
