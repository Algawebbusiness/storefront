/**
 * ACP — Get / Update checkout session
 *
 * GET   /api/acp/checkout/[id]
 * PATCH /api/acp/checkout/[id]
 *
 * Runs the `withAcpRoute` guard chain (scope `checkout.create`) and enforces
 * object-level ownership (IDOR/BOLA, CWE-639): a non-owning agent gets 404.
 */

import { NextResponse } from "next/server";
import { withAcpRoute } from "@/lib/protocols/acp/route-handler";
import { saleorQuery } from "@/mcp-server/saleor-client";
import { protocolToSaleor } from "@/lib/protocols/shared/address";
import { mapCheckoutToProtocol } from "@/lib/protocols/shared/checkout-mapper";
import { ownsCheckout } from "@/lib/protocols/shared/ownership";
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

interface CheckoutParams {
	id: string;
}

interface UpdateCheckoutBody {
	email?: string;
	shipping_address?: ProtocolAddress & { first_name?: string; last_name?: string; phone?: string };
	billing_address?: ProtocolAddress & { first_name?: string; last_name?: string; phone?: string };
	delivery_method_id?: string;
	promo_code?: string;
	remove_promo_code?: string;
}

function notFound() {
	return NextResponse.json(
		{ error: { code: "not_found", message: "Checkout session not found" } },
		{ status: 404 },
	);
}

export const GET = withAcpRoute<CheckoutParams>(
	{ action: "checkout.read", scope: "checkout.create", resourceId: (p) => p.id },
	async (_request, auth, { id }) => {
		const result = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });
		if (!result.ok) {
			return NextResponse.json({ error: { code: "server_error", message: result.error } }, { status: 500 });
		}
		if (!result.data.checkout || !ownsCheckout(result.data.checkout, auth)) {
			return notFound();
		}
		return NextResponse.json({ checkout_session: mapCheckoutToProtocol(result.data.checkout) });
	},
);

export const PATCH = withAcpRoute<CheckoutParams>(
	{ action: "checkout.update", scope: "checkout.create", resourceId: (p) => p.id },
	async (_request, auth, { id }) => {
		let body: UpdateCheckoutBody;
		try {
			body = JSON.parse(auth.bodyText) as UpdateCheckoutBody;
		} catch {
			return NextResponse.json(
				{ error: { code: "bad_request", message: "Invalid JSON body" } },
				{ status: 400 },
			);
		}

		// Verify checkout exists + ownership
		const fetchResult = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });
		if (!fetchResult.ok) {
			return NextResponse.json(
				{ error: { code: "server_error", message: fetchResult.error } },
				{ status: 500 },
			);
		}
		if (!fetchResult.data.checkout || !ownsCheckout(fetchResult.data.checkout, auth)) {
			return notFound();
		}

		let checkout: SaleorCheckout = fetchResult.data.checkout;

		if (body.email) {
			const emailResult = await saleorQuery<CheckoutEmailUpdateData>(CHECKOUT_EMAIL_UPDATE_MUTATION, {
				id,
				email: body.email,
			});
			if (emailResult.ok && emailResult.data.checkoutEmailUpdate.checkout) {
				checkout = emailResult.data.checkoutEmailUpdate.checkout;
			} else if (emailResult.ok && emailResult.data.checkoutEmailUpdate.errors.length > 0) {
				return NextResponse.json(
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
				return NextResponse.json(
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
				return NextResponse.json(
					{
						error: {
							code: "bad_request",
							message: billingResult.data.checkoutBillingAddressUpdate.errors
								.map((e) => e.message)
								.join("; "),
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
				return NextResponse.json(
					{
						error: {
							code: "bad_request",
							message: deliveryResult.data.checkoutDeliveryMethodUpdate.errors
								.map((e) => e.message)
								.join("; "),
						},
					},
					{ status: 400 },
				);
			}
		}

		if (body.remove_promo_code) {
			const removeResult = await saleorQuery<CheckoutRemovePromoCodeData>(
				CHECKOUT_REMOVE_PROMO_CODE_MUTATION,
				{
					checkoutId: id,
					promoCode: body.remove_promo_code,
				},
			);
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
				return NextResponse.json(
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

		return NextResponse.json({ checkout_session: mapCheckoutToProtocol(checkout) });
	},
);
