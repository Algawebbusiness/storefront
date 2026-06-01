/**
 * UCP REST — Create cart
 *
 * POST /api/ucp/rest/carts
 *
 * Body (all fields optional): {
 *   lines?:   [{ variant_id: string, quantity: number }],
 *   context?: { intent?, buyer_preferences?, session_id? }   // Phase A7
 * }
 *
 * Returns an empty cart by default; if `lines` are provided, they are added in
 * the same call (single Saleor `checkoutCreate`). UCP cart maps to a Saleor
 * `Checkout` in the pre-complete state — same backend object as a checkout
 * session, different protocol surface.
 *
 * If `context` is provided, it is persisted into Saleor metadata and echoed
 * back in the cart response.
 */

import { mapCheckoutToCart } from "@/lib/protocols/shared/cart-mapper";
import {
	CHECKOUT_BY_ID_QUERY,
	CHECKOUT_CREATE_MUTATION,
	UPDATE_METADATA_MUTATION,
	type CheckoutByIdData,
	type CheckoutCreateData,
	type UpdateMetadataData,
} from "@/lib/protocols/shared/checkout-queries";
import { contextToMetadataInput, validateContext } from "@/lib/protocols/shared/context-mapper";
import { agentBindingMetadataItem } from "@/lib/protocols/shared/ownership";
import { signedJsonResponse } from "@/lib/protocols/shared/response";
import { withUcpRoute } from "@/lib/protocols/shared/route-handler";
import type { UcpContext } from "@/lib/protocols/shared/types";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { getDefaultChannel, saleorQuery } from "@/mcp-server/saleor-client";

interface CreateCartLine {
	variant_id: string;
	quantity: number;
}

interface CreateCartBody {
	lines?: CreateCartLine[];
	context?: UcpContext;
}

export const POST = withUcpRoute({ action: "cart.create", scope: "cart.create" }, async (_request, auth) => {
	let body: CreateCartBody = {};
	if (auth.bodyText.length > 0) {
		try {
			body = JSON.parse(auth.bodyText) as CreateCartBody;
		} catch {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "Invalid JSON body" } },
				{ status: 400 },
			);
		}
	}

	const contextValidation = validateContext(body.context);
	if (!contextValidation.ok) {
		return signedJsonResponse(
			{
				error: {
					code: "bad_request",
					message: contextValidation.errors.map((e) => `${e.field}: ${e.message}`).join("; "),
				},
			},
			{ status: 400 },
		);
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

	let checkout = data.checkout;

	// SECURITY (IDOR, CWE-639): always bind the cart to the creating agent so
	// a different agent can't drive it by guessing its ID. Also persist agent
	// context metadata when provided.
	const contextMetadata = contextToMetadataInput(body.context, contextValidation.buyerPreferencesJson);
	const metadataInput = [agentBindingMetadataItem(auth.agent.id), ...(contextMetadata ?? [])];
	{
		const metaResult = await saleorQuery<UpdateMetadataData>(UPDATE_METADATA_MUTATION, {
			id: checkout.id,
			input: metadataInput,
		});
		if (!metaResult.ok) {
			return signedJsonResponse(
				{ error: { code: "server_error", message: metaResult.error } },
				{ status: 500 },
			);
		}
		const refetch = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id: checkout.id });
		if (refetch.ok && refetch.data.checkout) {
			checkout = refetch.data.checkout;
		}
	}

	const ucpMeta = await buildUcpMeta(auth.profileUrl);
	return signedJsonResponse({ ucp: ucpMeta, cart: mapCheckoutToCart(checkout) }, { status: 201 });
});
