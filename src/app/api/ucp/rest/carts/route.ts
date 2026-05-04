/**
 * UCP REST — Create cart
 *
 * POST /api/ucp/rest/carts
 *
 * Body (optional): {
 *   lines?: [{ sku?: string, variant_id?: string, quantity: number }]
 * }
 *
 * Returns an empty cart by default; if `lines` are provided, they are added in
 * the same call (single Saleor `checkoutCreate`). UCP cart maps to a Saleor
 * `Checkout` in the pre-complete state — same backend object as a checkout
 * session, different protocol surface.
 */

import { validateAgentApiKey } from "@/lib/protocols/shared/auth";
import { mapCheckoutToCart } from "@/lib/protocols/shared/cart-mapper";
import { CHECKOUT_CREATE_MUTATION, type CheckoutCreateData } from "@/lib/protocols/shared/checkout-queries";
import {
	signedJsonResponse,
	signedProtocolDisabled,
	signedUnauthorized,
} from "@/lib/protocols/shared/response";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { getDefaultChannel, saleorQuery } from "@/mcp-server/saleor-client";

interface CreateCartLine {
	variant_id: string;
	quantity: number;
}

interface CreateCartBody {
	lines?: CreateCartLine[];
}

export async function POST(request: Request) {
	if (process.env.UCP_ENABLED !== "true") {
		return signedProtocolDisabled("UCP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return signedUnauthorized();
	}

	let body: CreateCartBody = {};
	const text = await request.text();
	if (text.length > 0) {
		try {
			body = JSON.parse(text) as CreateCartBody;
		} catch {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "Invalid JSON body" } },
				{ status: 400 },
			);
		}
	}

	const lines = (body.lines ?? []).map((l) => ({
		variantId: l.variant_id,
		quantity: l.quantity,
	}));

	const channel = getDefaultChannel();
	const result = await saleorQuery<CheckoutCreateData>(CHECKOUT_CREATE_MUTATION, {
		input: { channel, lines },
	});

	if (!result.ok) {
		return signedJsonResponse({ error: { code: "server_error", message: result.error } }, { status: 500 });
	}

	const data = result.data.checkoutCreate;
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
		return signedJsonResponse(
			{ error: { code: "server_error", message: "Cart creation returned no data" } },
			{ status: 500 },
		);
	}

	const ucpMeta = await buildUcpMeta(auth.profileUrl);
	return signedJsonResponse({ ucp: ucpMeta, cart: mapCheckoutToCart(data.checkout) }, { status: 201 });
}
