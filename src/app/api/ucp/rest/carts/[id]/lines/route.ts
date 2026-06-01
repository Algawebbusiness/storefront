/**
 * UCP REST — Add line to cart
 *
 * POST /api/ucp/rest/carts/:id/lines
 *
 * Body: { variant_id: string, quantity: number }
 *
 * Saleor `checkoutLinesAdd` stacks the same variant rather than creating a new
 * line, which matches UCP cart semantics.
 */

import { mapCheckoutToCart } from "@/lib/protocols/shared/cart-mapper";
import {
	CHECKOUT_LINES_ADD_MUTATION,
	type CheckoutLinesAddData,
} from "@/lib/protocols/shared/checkout-queries";
import { signedJsonResponse } from "@/lib/protocols/shared/response";
import { withUcpRoute } from "@/lib/protocols/shared/route-handler";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { saleorQuery } from "@/mcp-server/saleor-client";

interface AddLineBody {
	variant_id: string;
	quantity: number;
}

interface CartParams {
	id: string;
}

/** Upper bound on a single cart line quantity (defense-in-depth / DoS, CWE-20). */
const MAX_LINE_QUANTITY = 10_000;

export const POST = withUcpRoute<CartParams>(
	{
		action: "cart.add_line",
		scope: "cart.update",
		resourceId: (p) => p.id,
	},
	async (_request, auth, { id }) => {
		let body: AddLineBody;
		try {
			body = JSON.parse(auth.bodyText) as AddLineBody;
		} catch {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "Invalid JSON body" } },
				{ status: 400 },
			);
		}

		if (
			!body.variant_id ||
			typeof body.quantity !== "number" ||
			!Number.isInteger(body.quantity) ||
			body.quantity < 1 ||
			body.quantity > MAX_LINE_QUANTITY
		) {
			return signedJsonResponse(
				{
					error: {
						code: "bad_request",
						message: `variant_id and an integer quantity between 1 and ${MAX_LINE_QUANTITY} are required`,
					},
				},
				{ status: 400 },
			);
		}

		const result = await saleorQuery<CheckoutLinesAddData>(CHECKOUT_LINES_ADD_MUTATION, {
			id,
			lines: [{ variantId: body.variant_id, quantity: body.quantity }],
		});

		if (!result.ok) {
			return signedJsonResponse({ error: { code: "server_error", message: result.error } }, { status: 500 });
		}

		const data = result.data.checkoutLinesAdd;
		if (data.errors.length > 0) {
			return signedJsonResponse(
				{
					error: {
						code: "bad_request",
						message: data.errors.map((e) => e.message).join("; "),
					},
				},
				{ status: 400 },
			);
		}

		if (!data.checkout) {
			return signedJsonResponse({ error: { code: "not_found", message: "Cart not found" } }, { status: 404 });
		}

		const ucpMeta = await buildUcpMeta(auth.profileUrl);
		return signedJsonResponse({ ucp: ucpMeta, cart: mapCheckoutToCart(data.checkout) }, { status: 201 });
	},
);
