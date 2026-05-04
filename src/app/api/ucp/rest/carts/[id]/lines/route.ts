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

import { validateAgentApiKey } from "@/lib/protocols/shared/auth";
import { mapCheckoutToCart } from "@/lib/protocols/shared/cart-mapper";
import {
	CHECKOUT_LINES_ADD_MUTATION,
	type CheckoutLinesAddData,
} from "@/lib/protocols/shared/checkout-queries";
import {
	signedJsonResponse,
	signedProtocolDisabled,
	signedUnauthorized,
} from "@/lib/protocols/shared/response";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { saleorQuery } from "@/mcp-server/saleor-client";

interface AddLineBody {
	variant_id: string;
	quantity: number;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	if (process.env.UCP_ENABLED !== "true") {
		return signedProtocolDisabled("UCP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return signedUnauthorized();
	}

	const { id } = await params;

	let body: AddLineBody;
	try {
		body = (await request.json()) as AddLineBody;
	} catch {
		return signedJsonResponse(
			{ error: { code: "bad_request", message: "Invalid JSON body" } },
			{ status: 400 },
		);
	}

	if (!body.variant_id || typeof body.quantity !== "number" || body.quantity < 1) {
		return signedJsonResponse(
			{
				error: {
					code: "bad_request",
					message: "variant_id and positive integer quantity are required",
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
}
