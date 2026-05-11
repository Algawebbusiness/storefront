/**
 * UCP REST — Cancel checkout session
 *
 * POST /api/ucp/rest/checkout-sessions/[id]/cancel
 *
 * Marks a checkout as cancelled. Saleor does not have a native cancel mutation,
 * so we return the cancelled status without modifying server state.
 * The checkout will expire naturally via Saleor's TTL.
 */

import { mapCheckoutToProtocol } from "@/lib/protocols/shared/checkout-mapper";
import { CHECKOUT_BY_ID_QUERY, type CheckoutByIdData } from "@/lib/protocols/shared/checkout-queries";
import { signedJsonResponse } from "@/lib/protocols/shared/response";
import { withUcpRoute } from "@/lib/protocols/shared/route-handler";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { saleorQuery } from "@/mcp-server/saleor-client";

interface CheckoutParams {
	id: string;
}

export const POST = withUcpRoute<CheckoutParams>(
	{
		action: "checkout.cancel",
		scope: "checkout.create",
		resourceId: (p) => p.id,
	},
	async (_request, auth, { id }) => {
		const fetchResult = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });
		if (!fetchResult.ok) {
			return signedJsonResponse(
				{ error: { code: "server_error", message: fetchResult.error } },
				{ status: 500 },
			);
		}
		if (!fetchResult.data.checkout) {
			return signedJsonResponse(
				{ error: { code: "not_found", message: "Checkout session not found" } },
				{ status: 404 },
			);
		}

		const ucpMeta = await buildUcpMeta(auth.profileUrl);

		return signedJsonResponse({
			ucp: ucpMeta,
			checkout_session: {
				...mapCheckoutToProtocol(fetchResult.data.checkout),
				status: "cancelled" as const,
			},
		});
	},
);
