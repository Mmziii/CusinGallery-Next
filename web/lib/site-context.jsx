"use client";
import { createContext, useContext, useEffect } from "react";
import { ensureCsrfCookie } from "../services/apiClient";
export const SiteContext = createContext(null);
export const useSite = () => useContext(SiteContext);
export function SiteProvider({ value, children }) {
  useEffect(() => { ensureCsrfCookie(); }, []);
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}
