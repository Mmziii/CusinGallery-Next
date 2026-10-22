import CartPage from "../../purchase/CartPage";
import { apiServer } from "../../lib/api-server";
import { privateMetadata, probeUser } from "../../lib/auth-server";

export const dynamic = "force-dynamic";
export const metadata = privateMetadata("سبد خرید");

export default async function CartRoute() {
  const user = await probeUser();
  let serverCart;
  if (user) {
    try {
      const data = await apiServer("/api/v1/cart/", { privateData: true });
      if (data && Array.isArray(data.items)) {
        serverCart = data;
      }
    } catch {
      serverCart = undefined;
    }
  }
  return <CartPage serverCart={serverCart} />;
}
