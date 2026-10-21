import Page from "../../auth/PasswordResetRequestPage";
import { guestOnly, privateMetadata } from "../../lib/auth-server";
export const dynamic = "force-dynamic";
export const metadata = privateMetadata("بازیابی رمز عبور");
export default async function AuthPage({ searchParams }) {
  
  return <Page />;
}
