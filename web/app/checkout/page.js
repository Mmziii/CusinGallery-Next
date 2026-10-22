import Page from "../../purchase/CheckoutPage";
import ProtectedRoute from "../../components/ProtectedRoute";
import { privateMetadata, requireUser } from "../../lib/auth-server";

export const dynamic = "force-dynamic";
export const metadata = privateMetadata("تکمیل خرید");

export default async function ProtectedPage() {
  const user = await requireUser();
  return (
    <ProtectedRoute serverUser={user}>
      <Page />
    </ProtectedRoute>
  );
}
