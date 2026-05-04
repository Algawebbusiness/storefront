/**
 * UCP REST — Get / Update checkout session
 *
 * GET  /api/ucp/rest/checkout-sessions/[id]
 * PATCH /api/ucp/rest/checkout-sessions/[id]
 *
 * PATCH body (all fields optional): {
 *   email?: string,
 *   shipping_address?: ProtocolAddress,
 *   billing_address?: ProtocolAddress,
 *   delivery_method_id?: string,
 *   promo_code?: string,
 *   remove_promo_code?: string,
 * }
 */

import { validateAgentApiKey } from "@/lib/protocols/shared/auth";
import {
	signedJsonResponse,
	signedProtocolDisabled,
	signedUnauthorized,
} from "@/lib/protocols/shared/response";
import { saleorQuery } from "@/mcp-server/saleor-client";
import { protocolToSaleor } from "@/lib/protocols/shared/address";
import { mapCheckoutToProtocol } from "@/lib/protocols/shared/checkout-mapper";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import {
	CHECKOUT_BY_ID_QUERY,
	CHECKOUT_EMAIL_UPDATE_MUTATION,
	CHECKOUT_SHIPPING_ADDRESS_UPDATE_MUTATION,
	CHECKOUT_BILLING_ADDRESS_UPDATE_MUTATION,
	CHECKOUT_DELIVERY_METHOD_UPDATE_MUTATION,
	CHECKOUT_ADD_PROMO_CODE_MUTATION,
	CHECKOUT_REMOVE_PROMO_CODE_MUTATION,
	type CheckoutByIdData,
	type CheckoutEmailUpdateData,
	type CheckoutShippingAddressUpdateData,
	type CheckoutBillingAddressUpdateData,
	type CheckoutDeliveryMethodUpdateData,
	type CheckoutAddPromoCodeData,
	type CheckoutRemovePromoCodeData,
	type SaleorCheckout,
} from "@/lib/protocols/shared/checkout-queries";
import type { ProtocolAddress } from "@/lib/protocols/shared/types";

interface UpdateCheckoutBody {
	email?: string;
	shipping_address?: ProtocolAddress & { first_name?: string; last_name?: string; phone?: string };
	billing_address?: ProtocolAddress & { first_name?: string; last_name?: string; phone?: string };
	delivery_method_id?: string;
	promo_code?: string;
	remove_promo_code?: string;
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
		return signedJsonResponse(
			{ error: { code: "not_found", message: "Checkout session not found" } },
			{ status: 404 },
		);
	}

	const ucpMeta = await buildUcpMeta(auth.profileUrl);

	return signedJsonResponse({
		ucp: ucpMeta,
		checkout_session: mapCheckoutToProtocol(result.data.checkout),
	});
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

	let body: UpdateCheckoutBody;
	try {
		body = (await request.json()) as UpdateCheckoutBody;
	} catch {
		return signedJsonResponse(
			{ error: { code: "bad_request", message: "Invalid JSON body" } },
			{ status: 400 },
		);
	}

	// Verify checkout exists first
	const fetchResult = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });
	if (!fetchResult.ok) {
		return signedJsonResponse(
			{ error: { code: "server_error", message: fetchResult.error } },
			{ status: 500 },
		);
	}
	if (!fetchResult.data.checkout) {
		return signedJsonResponse(
			{ error: { code: "not_found", message: "Checkout session not found" } },
			{ status: 404 },
		);
	}

	let checkout: SaleorCheckout = fetchResult.data.checkout;

	// Apply updates sequentially (each depends on previous state)
	if (body.email) {
		const emailResult = await saleorQuery<CheckoutEmailUpdateData>(CHECKOUT_EMAIL_UPDATE_MUTATION, {
			id,
			email: body.email,
		});
		if (emailResult.ok && emailResult.data.checkoutEmailUpdate.checkout) {
			checkout = emailResult.data.checkoutEmailUpdate.checkout;
		} else if (emailResult.ok && emailResult.data.checkoutEmailUpdate.errors.length > 0) {
			return signedJsonResponse(
				{
					error: {
						code: "bad_request",
						message: emailResult.data.checkoutEmailUpdate.errors.map((e) => e.message).join("; "),
					},
				},
				{ status: 400 },
			);
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
			{ id, shippingAddress: saleorAddr },
		);
		if (shippingResult.ok && shippingResult.data.checkoutShippingAddressUpdate.checkout) {
			checkout = shippingResult.data.checkoutShippingAddressUpdate.checkout;
		} else if (shippingResult.ok && shippingResult.data.checkoutShippingAddressUpdate.errors.length > 0) {
			return signedJsonResponse(
				{
					error: {
						code: "bad_request",
						message: shippingResult.data.checkoutShippingAddressUpdate.errors
							.map((e) => e.message)
							.join("; "),
					},
				},
				{ status: 400 },
			);
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
			{ id, billingAddress: saleorAddr },
		);
		if (billingResult.ok && billingResult.data.checkoutBillingAddressUpdate.checkout) {
			checkout = billingResult.data.checkoutBillingAddressUpdate.checkout;
		} else if (billingResult.ok && billingResult.data.checkoutBillingAddressUpdate.errors.length > 0) {
			return signedJsonResponse(
				{
					error: {
						code: "bad_request",
						message: billingResult.data.checkoutBillingAddressUpdate.errors.map((e) => e.message).join("; "),
					},
				},
				{ status: 400 },
			);
		}
	}

	if (body.delivery_method_id) {
		const deliveryResult = await saleorQuery<CheckoutDeliveryMethodUpdateData>(
			CHECKOUT_DELIVERY_METHOD_UPDATE_MUTATION,
			{ id, deliveryMethodId: body.delivery_method_id },
		);
		if (deliveryResult.ok && deliveryResult.data.checkoutDeliveryMethodUpdate.checkout) {
			checkout = deliveryResult.data.checkoutDeliveryMethodUpdate.checkout;
		} else if (deliveryResult.ok && deliveryResult.data.checkoutDeliveryMethodUpdate.errors.length > 0) {
			return signedJsonResponse(
				{
					error: {
						code: "bad_request",
						message: deliveryResult.data.checkoutDeliveryMethodUpdate.errors.map((e) => e.message).join("; "),
					},
				},
				{ status: 400 },
			);
		}
	}

	if (body.remove_promo_code) {
		const removeResult = await saleorQuery<CheckoutRemovePromoCodeData>(CHECKOUT_REMOVE_PROMO_CODE_MUTATION, {
			checkoutId: id,
			promoCode: body.remove_promo_code,
		});
		if (removeResult.ok && removeResult.data.checkoutRemovePromoCode.checkout) {
			checkout = removeResult.data.checkoutRemovePromoCode.checkout;
		}
	}

	if (body.promo_code) {
		const promoResult = await saleorQuery<CheckoutAddPromoCodeData>(CHECKOUT_ADD_PROMO_CODE_MUTATION, {
			checkoutId: id,
			promoCode: body.promo_code,
		});
		if (promoResult.ok && promoResult.data.checkoutAddPromoCode.checkout) {
			checkout = promoResult.data.checkoutAddPromoCode.checkout;
		} else if (promoResult.ok && promoResult.data.checkoutAddPromoCode.errors.length > 0) {
			return signedJsonResponse(
				{
					error: {
						code: "bad_request",
						message: promoResult.data.checkoutAddPromoCode.errors.map((e) => e.message).join("; "),
					},
				},
				{ status: 400 },
			);
		}
	}

	const ucpMeta = await buildUcpMeta(auth.profileUrl);

	return signedJsonResponse({
		ucp: ucpMeta,
		checkout_session: mapCheckoutToProtocol(checkout),
	});
}
