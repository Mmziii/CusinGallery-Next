import { useEffect, useState } from "react";
import { useSite } from "../lib/site-context";
import { fetchSiteSettings } from "../services/siteApi";

export default function useSiteSettings() {
  const site = useSite();
  const [fallback, setFallback] = useState(null);

  useEffect(() => {
    if (site !== null) return undefined;
    let cancelled = false;
    fetchSiteSettings()
      .then((data) => {
        if (!cancelled && data) setFallback(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [site]);

  return site?.settings || fallback || {};
}
