import Page from "../../auth/LoginPage";
import { guestOnly, privateMetadata } from "../../lib/auth-server";
export const dynamic = "force-dynamic";
export const metadata = privateMetadata("ورود به حساب کاربری");
export default async function AuthPage({ searchParams }) {
  await guestOnly(searchParams);
  return <Page />;
}
