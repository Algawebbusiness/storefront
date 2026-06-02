/**
 * ACP — Create checkout session
 *
 * POST /api/acp/checkout
 *
 * Body: {
 *   line_items: [{ variant_id, quantity }],
 *   email?: string,
 *   shipping_address?: ProtocolAddress,
 *   billing_address?: ProtocolAddress,
 * }
 *
 * Runs the `withAcpRoute` guard chain (scope `checkout.create`) and binds the
 * new checkout to the creating agent (IDOR defense, CWE-639).
 */

import { NextResponse } from "next/server";
import { withAcpRoute } from "@/lib/protocols/acp/route-handler";
import { saleorQuery, getDefaultChannel } from "@/mcp-server/saleor-client";
import { protocolToSaleor } from "@/lib/protocols/shared/address";
import { mapCheckoutToProtocol } from "@/lib/protocols/shared/checkout-mapper";
import { agentBindingMetadataItem } from "@/lib/protocols/shared/ownership";
import {
	CHECKOUT_BY_ID_QUERY,
	CHECKOUT_CREATE_MUTATION,
	CHECKOUT_EMAIL_UPDATE_MUTATION,
	CHECKOUT_SHIPPING_ADDRESS_UPDATE_MUTATION,
	CHECKOUT_BILLING_ADDRESS_UPDATE_MUTATION,
	UPDATE_METADATA_MUTATION,
	type CheckoutByIdData,
	type CheckoutCreateData,
	type CheckoutEmailUpdateData,
	type CheckoutShippingAddressUpdateData,
	type CheckoutBillingAddressUpdateData,
	type UpdateMetadataData,
	type SaleorCheckout,
} from "@/lib/protocols/shared/checkout-queries";
import type { ProtocolAddress } from "@/lib/protocols/shared/types";

interface CreateAcpCheckoutBody {
	line_items: Array<{ variant_id: string; quantity: number }>;
	email?: string;
	shipping_address?: ProtocolAddress & { first_name?: string; last_name?: string; phone?: string };
	billing_address?: ProtocolAddress & { first_name?: string; last_name?: string; phone?: string };
}

export const POST = withAcpRoute(
	{ action: "checkout.create", scope: "checkout.create" },
	async (_request, auth) => {
		let body: CreateAcpCheckoutBody;
		try {
			body = JSON.parse(auth.bodyText) as CreateAcpCheckoutBody;
		} catch {
			return NextResponse.json(
				{ error: { code: "bad_request", message: "Invalid JSON body" } },
				{ status: 400 },
			);
		}

		if (!body.line_items || !Array.isArray(body.line_items) || body.line_items.length === 0) {
			return NextResponse.json(
				{ error: { code: "bad_request", message: "line_items is required and must be non-empty" } },
				{ status: 400 },
			);
		}

		const channel = getDefaultChannel();
		const lines = body.line_items.map((item) => ({ variantId: item.variant_id, quantity: item.quantity }));

		const createResult = await saleorQuery<CheckoutCreateData>(CHECKOUT_CREATE_MUTATION, {
			input: { channel, lines },
		});
		if (!createResult.ok) {
			return NextResponse.json(
				{ error: { code: "server_error", message: createResult.error } },
				{ status: 500 },
			);
		}

		const createData = createResult.data.checkoutCreate;
		if (createData.errors.length > 0) {
			return NextResponse.json(
				{ error: { code: "bad_request", message: createData.errors.map((e) => e.message).join("; ") } },
				{ status: 400 },
			);
		}

		let checkout: SaleorCheckout | null = createData.checkout;
		if (!checkout) {
			return NextResponse.json(
				{ error: { code: "server_error", message: "Checkout creation returned no data" } },
				{ status: 500 },
			);
		}

		// SECURITY (IDOR, CWE-639): bind the checkout to the creating agent.
		await saleorQuery<UpdateMetadataData>(UPDATE_METADATA_MUTATION, {
			id: checkout.id,
			input: [agentBindingMetadataItem(auth.agent.id)],
		});

		if (body.email) {
			const emailResult = await saleorQuery<CheckoutEmailUpdateData>(CHECKOUT_EMAIL_UPDATE_MUTATION, {
				id: checkout.id,
				email: body.email,
			});
			if (emailResult.ok && emailResult.data.checkoutEmailUpdate.checkout) {
				checkout = emailResult.data.checkoutEmailUpdate.checkout;
			}
		}

		if (body.shipping_address) {
			const addr = body.shipping_address;
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

		if (body.billing_address) {
			const addr = body.billing_address;
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

		// Re-fetch so the response reflects the binding + any updates.
		const refetch = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id: checkout.id });
		if (refetch.ok && refetch.data.checkout) {
			checkout = refetch.data.checkout;
		}

		return NextResponse.json({ checkout_session: mapCheckoutToProtocol(checkout) }, { status: 201 });
	},
);
