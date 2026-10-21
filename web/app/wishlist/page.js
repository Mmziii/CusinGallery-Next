import Page from "../../auth/WishlistPage";
import ProtectedRoute from "../../components/ProtectedRoute";
import { requireUser, privateMetadata } from "../../lib/auth-server";
export const dynamic = "force-dynamic";
export const metadata = privateMetadata("علاقه‌مندی‌ها");
export default async function ProtectedPage() {
  const user = await requireUser();
  return <ProtectedRoute serverUser={user}><Page /></ProtectedRoute>;
}
