import Page from "../../auth/RegisterPage";
import { guestOnly, privateMetadata } from "../../lib/auth-server";
export const dynamic = "force-dynamic";
export const metadata = privateMetadata("ثبت‌نام");
export default async function AuthPage({ searchParams }) {
  await guestOnly(searchParams);
  return <Page />;
}
