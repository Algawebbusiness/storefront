/**
 * UCP REST — Update / remove a single cart line
 *
 * PATCH  /api/ucp/rest/carts/:id/lines/:lineId  body: { quantity: number }
 * DELETE /api/ucp/rest/carts/:id/lines/:lineId  → remove the line
 *
 * Maps onto Saleor `checkoutLinesUpdate` and `checkoutLinesDelete`.
 */

import { validateAgentApiKey } from "@/lib/protocols/shared/auth";
import { mapCheckoutToCart } from "@/lib/protocols/shared/cart-mapper";
import {
	CHECKOUT_LINES_DELETE_MUTATION,
	CHECKOUT_LINES_UPDATE_MUTATION,
	type CheckoutLinesDeleteData,
	type CheckoutLinesUpdateData,
} from "@/lib/protocols/shared/checkout-queries";
import {
	signedJsonResponse,
	signedProtocolDisabled,
	signedUnauthorized,
} from "@/lib/protocols/shared/response";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { saleorQuery } from "@/mcp-server/saleor-client";

interface UpdateLineBody {
	quantity: number;
}

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string; lineId: string }> },
) {
	if (process.env.UCP_ENABLED !== "true") {
		return signedProtocolDisabled("UCP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return signedUnauthorized();
	}

	const { id, lineId } = await params;

	let body: UpdateLineBody;
	try {
		body = (await request.json()) as UpdateLineBody;
	} catch {
		return signedJsonResponse(
			{ error: { code: "bad_request", message: "Invalid JSON body" } },
			{ status: 400 },
		);
	}

	if (typeof body.quantity !== "number" || body.quantity < 1) {
		return signedJsonResponse(
			{
				error: {
					code: "bad_request",
					message: "quantity must be a positive integer (use DELETE to remove a line)",
				},
			},
			{ status: 400 },
		);
	}

	const result = await saleorQuery<CheckoutLinesUpdateData>(CHECKOUT_LINES_UPDATE_MUTATION, {
		id,
		lines: [{ lineId, quantity: body.quantity }],
	});

	if (!result.ok) {
		return signedJsonResponse({ error: { code: "server_error", message: result.error } }, { status: 500 });
	}

	const data = result.data.checkoutLinesUpdate;
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
	return signedJsonResponse({ ucp: ucpMeta, cart: mapCheckoutToCart(data.checkout) });
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string; lineId: string }> },
) {
	if (process.env.UCP_ENABLED !== "true") {
		return signedProtocolDisabled("UCP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return signedUnauthorized();
	}

	const { id, lineId } = await params;

	const result = await saleorQuery<CheckoutLinesDeleteData>(CHECKOUT_LINES_DELETE_MUTATION, {
		id,
		linesIds: [lineId],
	});

	if (!result.ok) {
		return signedJsonResponse({ error: { code: "server_error", message: result.error } }, { status: 500 });
	}

	const data = result.data.checkoutLinesDelete;
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
	return signedJsonResponse({ ucp: ucpMeta, cart: mapCheckoutToCart(data.checkout) });
}
