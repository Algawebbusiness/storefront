/**
 * UCP REST — Remove a previously applied loyalty / gift-card / voucher code
 * from a cart (Phase C10).
 *
 * DELETE /api/ucp/rest/carts/:id/loyalty/:appliedId
 *
 * `:appliedId` is the promo code string (URL-decoded). Saleor's
 * `checkoutRemovePromoCode` accepts the code directly, so we don't need a
 * separate "application ID" — agents pass the same code they used to apply.
 */

import { mapCheckoutToCart } from "@/lib/protocols/shared/cart-mapper";
import { removeLoyaltyCode } from "@/lib/protocols/shared/loyalty-mapper";
import { signedJsonResponse } from "@/lib/protocols/shared/response";
import { withUcpRoute } from "@/lib/protocols/shared/route-handler";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";

interface LoyaltyParams {
	id: string;
	appliedId: string;
}

export const DELETE = withUcpRoute<LoyaltyParams>(
	{
		action: "cart.remove_loyalty",
		scope: "cart.update",
		resourceId: (p) => p.id,
	},
	async (_request, auth, { id, appliedId }) => {
		const code = decodeURIComponent(appliedId).trim();
		if (!code) {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "Applied code is required" } },
				{ status: 400 },
			);
		}

		const outcome = await removeLoyaltyCode(id, code);
		if (!outcome.ok) return outcome.response;

		const ucpMeta = await buildUcpMeta(auth.profileUrl);
		return signedJsonResponse({
			ucp: ucpMeta,
			cart: mapCheckoutToCart(outcome.checkout),
			removed: { code },
		});
	},
);
