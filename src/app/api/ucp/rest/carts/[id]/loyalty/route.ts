/**
 * UCP REST — Apply a loyalty / gift-card / voucher code to a cart (Phase C10).
 *
 * POST   /api/ucp/rest/carts/:id/loyalty   body: { code: string }
 *
 * Maps to Saleor's `checkoutAddPromoCode` mutation; gift cards and vouchers
 * share the same endpoint there. On success the response carries the
 * updated cart with the new totals + `applied_discounts[]`.
 */

import { mapCheckoutToCart } from "@/lib/protocols/shared/cart-mapper";
import { applyLoyaltyCode } from "@/lib/protocols/shared/loyalty-mapper";
import { signedJsonResponse } from "@/lib/protocols/shared/response";
import { withUcpRoute } from "@/lib/protocols/shared/route-handler";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";

interface ApplyLoyaltyBody {
	code?: string;
}

interface CartParams {
	id: string;
}

export const POST = withUcpRoute<CartParams>(
	{
		action: "cart.apply_loyalty",
		scope: "cart.update",
		resourceId: (p) => p.id,
	},
	async (_request, auth, { id }) => {
		let body: ApplyLoyaltyBody;
		try {
			body = JSON.parse(auth.bodyText) as ApplyLoyaltyBody;
		} catch {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "Invalid JSON body" } },
				{ status: 400 },
			);
		}

		const code = body.code?.trim();
		if (!code) {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "code is required" } },
				{ status: 400 },
			);
		}

		const outcome = await applyLoyaltyCode(id, code);
		if (!outcome.ok) return outcome.response;

		const ucpMeta = await buildUcpMeta(auth.profileUrl);
		return signedJsonResponse({
			ucp: ucpMeta,
			cart: mapCheckoutToCart(outcome.checkout),
			applied: { code },
		});
	},
);
