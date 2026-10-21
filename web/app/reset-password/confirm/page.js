import Page from "../../../auth/PasswordResetConfirmPage";
import { guestOnly, privateMetadata } from "../../../lib/auth-server";
export const dynamic = "force-dynamic";
export const metadata = privateMetadata("تعیین رمز عبور جدید");
export default async function AuthPage({ searchParams }) {
  
  return <Page />;
}
