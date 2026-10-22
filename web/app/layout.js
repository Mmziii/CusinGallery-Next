import { headers } from "next/headers";
import "../styles/fonts.css";
import "../styles/variables.css";
import "../styles/globals.css";
import "../styles/storefront.css";
import "../styles/responsive-variants.css";
import { AuthProvider } from "../store/useAuthStore";
import { probeUser } from "../lib/auth-server";
import { isProtectedPath } from "../lib/auth-navigation";
import MainLayout from "../layouts/MainLayout";
import Analytics from "../components/Analytics";
import { SiteProvider } from "../lib/site-context";
import { getSite } from "../lib/api-server";
export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#2F3A18" };
export default async function RootLayout({ children }) {
  // Establish request rendering outside API fallbacks (do not swallow Next dynamic signals).
  const incoming = await headers();
  const path = incoming.get("x-auth-original-url") || "";
  const user = isProtectedPath(path.split("?")[0]) ? await probeUser() : undefined;
  const site = await getSite();
  return <html lang="fa" dir="rtl" style={site.content.theme?.css_variables || {}}><head>
    <link rel="icon" href={site.content.brand?.favicon || "/favicon.svg"} />
    <link rel="preload" href="/fonts/vazirmatn-arabic-wght-normal.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
  </head><body><div id="root"><AuthProvider user={user}><SiteProvider value={site}><Analytics /><MainLayout>{children}</MainLayout></SiteProvider></AuthProvider></div></body></html>;
}
