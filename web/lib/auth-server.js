import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { apiServer } from "./api-server";
import { loginUrl, safeNext } from "./auth-navigation";

// React cache deduplicates within ONE render only, never between visitors.
export const probeUser = cache(async () => {
  try {
    const data = await apiServer("/api/v1/accounts/me/", { privateData: true });
    return data?.id ? data : null;
  } catch { return undefined; } // unknown != anonymous; fail open
});
export async function requireUser() {
  const user = await probeUser();
  if (user === null) {
    const incoming = await headers();
    redirect(loginUrl(incoming.get("x-auth-original-url") || "/account/"));
  }
  return user;
}
export async function guestOnly(searchParams) {
  const user = await probeUser();
  if (user) {
    const params = await searchParams;
    redirect(params?.next === undefined ? "/account/" : safeNext(params.next));
  }
}
export const privateMetadata = (title) => ({ title: `${title} | کازین گالری`, robots: { index: false, follow: true } });
