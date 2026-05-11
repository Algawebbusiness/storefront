/**
 * UCP REST — Create checkout session
 *
 * POST /api/ucp/rest/checkout-sessions
 *
 * Body: {
 *   line_items: [{ variant_id, quantity }],
 *   buyer?: { email, shipping_address?, billing_address? }
 * }
 */

import { protocolToSaleor } from "@/lib/protocols/shared/address";
import { mapCheckoutToProtocol } from "@/lib/protocols/shared/checkout-mapper";
import {
	CHECKOUT_BY_ID_QUERY,
	CHECKOUT_BILLING_ADDRESS_UPDATE_MUTATION,
	CHECKOUT_CREATE_MUTATION,
	CHECKOUT_EMAIL_UPDATE_MUTATION,
	CHECKOUT_SHIPPING_ADDRESS_UPDATE_MUTATION,
	UPDATE_METADATA_MUTATION,
	type CheckoutBillingAddressUpdateData,
	type CheckoutByIdData,
	type CheckoutCreateData,
	type CheckoutEmailUpdateData,
	type CheckoutShippingAddressUpdateData,
	type SaleorCheckout,
	type UpdateMetadataData,
} from "@/lib/protocols/shared/checkout-queries";
import { contextToMetadataInput, validateContext } from "@/lib/protocols/shared/context-mapper";
import { signedJsonResponse } from "@/lib/protocols/shared/response";
import { withUcpRoute } from "@/lib/protocols/shared/route-handler";
import type { ProtocolAddress, UcpContext } from "@/lib/protocols/shared/types";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { getDefaultChannel, saleorQuery } from "@/mcp-server/saleor-client";

interface CreateCheckoutBody {
	line_items: Array<{ variant_id: string; quantity: number }>;
	buyer?: {
		email?: string;
		shipping_address?: ProtocolAddress & { first_name?: string; last_name?: string; phone?: string };
		billing_address?: ProtocolAddress & { first_name?: string; last_name?: string; phone?: string };
	};
	context?: UcpContext;
}

export const POST = withUcpRoute(
	{ action: "checkout.create", scope: "checkout.create" },
	async (_request, auth) => {
		let body: CreateCheckoutBody;
		try {
			body = JSON.parse(auth.bodyText) as CreateCheckoutBody;
		} catch {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "Invalid JSON body" } },
				{ status: 400 },
			);
		}

		if (!body.line_items || !Array.isArray(body.line_items) || body.line_items.length === 0) {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "line_items is required and must be non-empty" } },
				{ status: 400 },
			);
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

		const channel = getDefaultChannel();

		// Create checkout with lines
		const lines = body.line_items.map((item) => ({
			variantId: item.variant_id,
			quantity: item.quantity,
		}));

		const createResult = await saleorQuery<CheckoutCreateData>(CHECKOUT_CREATE_MUTATION, {
			input: { channel, lines },
		});

		if (!createResult.ok) {
			return signedJsonResponse(
				{ error: { code: "server_error", message: createResult.error } },
				{ status: 500 },
			);
		}

		const createData = createResult.data.checkoutCreate;
		if (createData.errors.length > 0) {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: createData.errors.map((e) => e.message).join("; ") } },
				{ status: 400 },
			);
		}

		let checkout: SaleorCheckout | null = createData.checkout;
		if (!checkout) {
			return signedJsonResponse(
				{ error: { code: "server_error", message: "Checkout creation returned no data" } },
				{ status: 500 },
			);
		}

		// Update email if provided
		if (body.buyer?.email) {
			const emailResult = await saleorQuery<CheckoutEmailUpdateData>(CHECKOUT_EMAIL_UPDATE_MUTATION, {
				id: checkout.id,
				email: body.buyer.email,
			});

			if (emailResult.ok && emailResult.data.checkoutEmailUpdate.checkout) {
				checkout = emailResult.data.checkoutEmailUpdate.checkout;
			}
		}

		// Update shipping address if provided
		if (body.buyer?.shipping_address) {
			const addr = body.buyer.shipping_address;
			const saleorAddr = protocolToSaleor(addr, {
				firstName: addr.first_name,
				lastName: addr.last_name,
				phone: addr.phone,
			});

			const shippingResult = await saleorQuery<CheckoutShippingAddressUpdateData>(
				CHECKOUT_SHIPPING_ADDRESS_UPDATE_MUTATION,
				{ id: checkout.id, shippingAddress: saleorAddr },
			);

			if (shippingResult.ok && shippingResult.data.checkoutShippingAddressUpdate.checkout) {
				checkout = shippingResult.data.checkoutShippingAddressUpdate.checkout;
			}
		}

		// Update billing address if provided
		if (body.buyer?.billing_address) {
			const addr = body.buyer.billing_address;
			const saleorAddr = protocolToSaleor(addr, {
				firstName: addr.first_name,
				lastName: addr.last_name,
				phone: addr.phone,
			});

			const billingResult = await saleorQuery<CheckoutBillingAddressUpdateData>(
				CHECKOUT_BILLING_ADDRESS_UPDATE_MUTATION,
				{ id: checkout.id, billingAddress: saleorAddr },
			);

			if (billingResult.ok && billingResult.data.checkoutBillingAddressUpdate.checkout) {
				checkout = billingResult.data.checkoutBillingAddressUpdate.checkout;
			}
		}

		// Persist agent context to Saleor metadata if provided (Phase A7).
		const metadataInput = contextToMetadataInput(body.context, contextValidation.buyerPreferencesJson);
		if (metadataInput) {
			const metaResult = await saleorQuery<UpdateMetadataData>(UPDATE_METADATA_MUTATION, {
				id: checkout.id,
				input: metadataInput,
			});
			if (metaResult.ok) {
				const refetch = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id: checkout.id });
				if (refetch.ok && refetch.data.checkout) {
					checkout = refetch.data.checkout;
				}
			}
		}

		const ucpMeta = await buildUcpMeta(auth.profileUrl);

		return signedJsonResponse(
			{
				ucp: ucpMeta,
				checkout_session: mapCheckoutToProtocol(checkout),
			},
			{ status: 201 },
		);
	},
);
