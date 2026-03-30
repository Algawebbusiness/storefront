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

import { NextResponse } from "next/server";
import { validateAgentApiKey, unauthorizedResponse, protocolDisabledResponse } from "@/lib/protocols/shared/auth";
import { saleorQuery, getDefaultChannel } from "@/mcp-server/saleor-client";
import { protocolToSaleor } from "@/lib/protocols/shared/address";
import { mapCheckoutToProtocol } from "@/lib/protocols/shared/checkout-mapper";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import {
	CHECKOUT_CREATE_MUTATION,
	CHECKOUT_EMAIL_UPDATE_MUTATION,
	CHECKOUT_SHIPPING_ADDRESS_UPDATE_MUTATION,
	CHECKOUT_BILLING_ADDRESS_UPDATE_MUTATION,
	type CheckoutCreateData,
	type CheckoutEmailUpdateData,
	type CheckoutShippingAddressUpdateData,
	type CheckoutBillingAddressUpdateData,
	type SaleorCheckout,
} from "@/lib/protocols/shared/checkout-queries";
import type { ProtocolAddress } from "@/lib/protocols/shared/types";

interface CreateCheckoutBody {
	line_items: Array<{ variant_id: string; quantity: number }>;
	buyer?: {
		email?: string;
		shipping_address?: ProtocolAddress & { first_name?: string; last_name?: string; phone?: string };
		billing_address?: ProtocolAddress & { first_name?: string; last_name?: string; phone?: string };
	};
}

export async function POST(request: Request) {
	if (process.env.UCP_ENABLED !== "true") {
		return protocolDisabledResponse("UCP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return unauthorizedResponse();
	}

	let body: CreateCheckoutBody;
	try {
		body = (await request.json()) as CreateCheckoutBody;
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

	// Create checkout with lines
	const lines = body.line_items.map((item) => ({
		variantId: item.variant_id,
		quantity: item.quantity,
	}));

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

	const ucpMeta = await buildUcpMeta(auth.profileUrl);

	return NextResponse.json(
		{
			ucp: ucpMeta,
			checkout_session: mapCheckoutToProtocol(checkout),
		},
		{ status: 201 },
	);
}
