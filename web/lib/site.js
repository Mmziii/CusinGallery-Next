/**
 * Canonical public origin and site name, shared by server metadata/JSON-LD and
 * the (server-safe) share-image helper.
 *
 * SITE_ORIGIN is the deployment-wide variable phase 1 already used; the
 * NEXT_PUBLIC_ alias keeps the same value available in client bundles.
 */
const configured = process.env.SITE_ORIGIN || process.env.NEXT_PUBLIC_SITE_ORIGIN || "https://cusin.ir";

export const SITE_ORIGIN = configured.replace(/\/$/, "");
export const SITE_NAME = "کازین گالری";
