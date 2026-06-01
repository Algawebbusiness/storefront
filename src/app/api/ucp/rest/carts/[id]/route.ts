/**
 * UCP REST — Read / update / cancel cart
 *
 * GET    /api/ucp/rest/carts/:id  → read cart (includes echoed `context`)
 * PATCH  /api/ucp/rest/carts/:id  → update agent context: { context: { intent?, buyer_preferences?, session_id? } }
 * DELETE /api/ucp/rest/carts/:id  → return cart with status="cancelled" (Saleor
 *                                    has no native cart cancel; the checkout TTL
 *                                    will clean it up)
 */

import { mapCheckoutToCart } from "@/lib/protocols/shared/cart-mapper";
import {
	CHECKOUT_BY_ID_QUERY,
	UPDATE_METADATA_MUTATION,
	type CheckoutByIdData,
	type UpdateMetadataData,
} from "@/lib/protocols/shared/checkout-queries";
import { contextToMetadataInput, validateContext } from "@/lib/protocols/shared/context-mapper";
import { ownsCheckout } from "@/lib/protocols/shared/ownership";
import { signedJsonResponse } from "@/lib/protocols/shared/response";
import { withUcpRoute } from "@/lib/protocols/shared/route-handler";
import type { UcpContext } from "@/lib/protocols/shared/types";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { saleorQuery } from "@/mcp-server/saleor-client";

interface PatchCartBody {
	context?: UcpContext;
}

interface CartParams {
	id: string;
}

export const GET = withUcpRoute<CartParams>(
	{
		action: "cart.read",
		scope: "cart.create",
		resourceId: (p) => p.id,
	},
	async (_request, auth, { id }) => {
		const result = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });

		if (!result.ok) {
			return signedJsonResponse({ error: { code: "server_error", message: result.error } }, { status: 500 });
		}
		if (!result.data.checkout || !ownsCheckout(result.data.checkout, auth)) {
			// 404 (not 403) so a non-owner can't confirm the cart exists (CWE-639).
			return signedJsonResponse({ error: { code: "not_found", message: "Cart not found" } }, { status: 404 });
		}

		const ucpMeta = await buildUcpMeta(auth.profileUrl);
		return signedJsonResponse({ ucp: ucpMeta, cart: mapCheckoutToCart(result.data.checkout) });
	},
);

export const PATCH = withUcpRoute<CartParams>(
	{
		action: "cart.update",
		scope: "cart.update",
		resourceId: (p) => p.id,
	},
	async (_request, auth, { id }) => {
		let body: PatchCartBody = {};
		if (auth.bodyText.length > 0) {
			try {
				body = JSON.parse(auth.bodyText) as PatchCartBody;
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

		// Verify cart exists.
		const fetchResult = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });
		if (!fetchResult.ok) {
			return signedJsonResponse(
				{ error: { code: "server_error", message: fetchResult.error } },
				{ status: 500 },
			);
		}
		if (!fetchResult.data.checkout || !ownsCheckout(fetchResult.data.checkout, auth)) {
			return signedJsonResponse({ error: { code: "not_found", message: "Cart not found" } }, { status: 404 });
		}

		const metadataInput = contextToMetadataInput(body.context, contextValidation.buyerPreferencesJson);

		if (metadataInput) {
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

		// Re-fetch so the cart response reflects the freshly written context.
		const refetch = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });
		const checkout = refetch.ok && refetch.data.checkout ? refetch.data.checkout : fetchResult.data.checkout;

		const ucpMeta = await buildUcpMeta(auth.profileUrl);
		return signedJsonResponse({ ucp: ucpMeta, cart: mapCheckoutToCart(checkout) });
	},
);

export const DELETE = withUcpRoute<CartParams>(
	{
		action: "cart.cancel",
		scope: "cart.update",
		resourceId: (p) => p.id,
	},
	async (_request, auth, { id }) => {
		const result = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });

		if (!result.ok) {
			return signedJsonResponse({ error: { code: "server_error", message: result.error } }, { status: 500 });
		}
		if (!result.data.checkout || !ownsCheckout(result.data.checkout, auth)) {
			return signedJsonResponse({ error: { code: "not_found", message: "Cart not found" } }, { status: 404 });
		}

		const ucpMeta = await buildUcpMeta(auth.profileUrl);
		return signedJsonResponse({
			ucp: ucpMeta,
			cart: mapCheckoutToCart(result.data.checkout, { status: "cancelled" }),
		});
	},
);
