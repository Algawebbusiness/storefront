/**
 * UCP REST — Read / update / cancel cart
 *
 * GET    /api/ucp/rest/carts/:id  → read cart
 * PATCH  /api/ucp/rest/carts/:id  → store {intent?, notes?} into Saleor metadata
 * DELETE /api/ucp/rest/carts/:id  → return cart with status="cancelled" (Saleor
 *                                    has no native cart cancel; the checkout TTL
 *                                    will clean it up)
 */

import { validateAgentApiKey } from "@/lib/protocols/shared/auth";
import { mapCheckoutToCart } from "@/lib/protocols/shared/cart-mapper";
import {
	CHECKOUT_BY_ID_QUERY,
	UPDATE_METADATA_MUTATION,
	type CheckoutByIdData,
	type UpdateMetadataData,
} from "@/lib/protocols/shared/checkout-queries";
import {
	signedJsonResponse,
	signedProtocolDisabled,
	signedUnauthorized,
} from "@/lib/protocols/shared/response";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { saleorQuery } from "@/mcp-server/saleor-client";

interface PatchCartBody {
	intent?: string;
	notes?: string;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	if (process.env.UCP_ENABLED !== "true") {
		return signedProtocolDisabled("UCP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return signedUnauthorized();
	}

	const { id } = await params;
	const result = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });

	if (!result.ok) {
		return signedJsonResponse({ error: { code: "server_error", message: result.error } }, { status: 500 });
	}
	if (!result.data.checkout) {
		return signedJsonResponse({ error: { code: "not_found", message: "Cart not found" } }, { status: 404 });
	}

	const ucpMeta = await buildUcpMeta(auth.profileUrl);
	return signedJsonResponse({ ucp: ucpMeta, cart: mapCheckoutToCart(result.data.checkout) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
	if (process.env.UCP_ENABLED !== "true") {
		return signedProtocolDisabled("UCP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return signedUnauthorized();
	}

	const { id } = await params;

	let body: PatchCartBody = {};
	const text = await request.text();
	if (text.length > 0) {
		try {
			body = JSON.parse(text) as PatchCartBody;
		} catch {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "Invalid JSON body" } },
				{ status: 400 },
			);
		}
	}

	// Verify cart exists.
	const fetchResult = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });
	if (!fetchResult.ok) {
		return signedJsonResponse(
			{ error: { code: "server_error", message: fetchResult.error } },
			{ status: 500 },
		);
	}
	if (!fetchResult.data.checkout) {
		return signedJsonResponse({ error: { code: "not_found", message: "Cart not found" } }, { status: 404 });
	}

	const metadataInput: Array<{ key: string; value: string }> = [];
	if (body.intent !== undefined) metadataInput.push({ key: "ucp.intent", value: body.intent });
	if (body.notes !== undefined) metadataInput.push({ key: "ucp.notes", value: body.notes });

	if (metadataInput.length > 0) {
		const metaResult = await saleorQuery<UpdateMetadataData>(UPDATE_METADATA_MUTATION, {
			id,
			input: metadataInput,
		});
		if (!metaResult.ok) {
			return signedJsonResponse(
				{ error: { code: "server_error", message: metaResult.error } },
				{ status: 500 },
			);
		}
		if (metaResult.data.updateMetadata.errors.length > 0) {
			return signedJsonResponse(
				{
					error: {
						code: "bad_request",
						message: metaResult.data.updateMetadata.errors.map((e) => e.message).join("; "),
					},
				},
				{ status: 400 },
			);
		}
	}

	// Re-fetch so totals/warnings reflect any cart-level state change.
	const refetch = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });
	const checkout = refetch.ok && refetch.data.checkout ? refetch.data.checkout : fetchResult.data.checkout;

	const ucpMeta = await buildUcpMeta(auth.profileUrl);
	return signedJsonResponse({ ucp: ucpMeta, cart: mapCheckoutToCart(checkout) });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
	if (process.env.UCP_ENABLED !== "true") {
		return signedProtocolDisabled("UCP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return signedUnauthorized();
	}

	const { id } = await params;
	const result = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });

	if (!result.ok) {
		return signedJsonResponse({ error: { code: "server_error", message: result.error } }, { status: 500 });
	}
	if (!result.data.checkout) {
		return signedJsonResponse({ error: { code: "not_found", message: "Cart not found" } }, { status: 404 });
	}

	const ucpMeta = await buildUcpMeta(auth.profileUrl);
	return signedJsonResponse({
		ucp: ucpMeta,
		cart: mapCheckoutToCart(result.data.checkout, { status: "cancelled" }),
	});
}
