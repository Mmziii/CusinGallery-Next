import Page from "../../../auth/account/ReviewsPage";
import ProtectedRoute from "../../../components/ProtectedRoute";
import { requireUser, privateMetadata } from "../../../lib/auth-server";
export const dynamic = "force-dynamic";
export const metadata = privateMetadata("حساب کاربری");
export default async function ProtectedPage() {
  const user = await requireUser();
  return <ProtectedRoute serverUser={user}><Page /></ProtectedRoute>;
}
