/**
 * Maps Saleor checkout state to protocol format (used by both ACP and UCP).
 */

import type { CheckoutStatus, ProtocolLineItem, ProtocolMoney, ProtocolTotals } from "./types";
import type { SaleorCheckout, SaleorCheckoutAddress, SaleorShippingMethod } from "./checkout-queries";
import { toMinorUnits } from "./money";
import { saleorToProtocol } from "./address";
import type { ProtocolAddress, SaleorAddress } from "./types";

const STOREFRONT_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL || "http://localhost:3000";

/** Shipping method in protocol format */
export interface ProtocolShippingMethod {
	id: string;
	name: string;
	price: ProtocolMoney;
	estimated_days_min?: number;
	estimated_days_max?: number;
}

/** Full protocol checkout representation */
export interface ProtocolCheckout {
	id: string;
	status: CheckoutStatus;
	email: string | null;
	line_items: ProtocolLineItem[];
	totals: ProtocolTotals;
	shipping_address: ProtocolAddress | null;
	billing_address: ProtocolAddress | null;
	delivery_method: { id: string; name: string } | null;
	available_shipping_methods: ProtocolShippingMethod[];
	continue_url: string;
}

/** Convert a Saleor checkout address to SaleorAddress type for address mapper */
function toSaleorAddress(addr: SaleorCheckoutAddress): SaleorAddress {
	return {
		firstName: addr.firstName,
		lastName: addr.lastName,
		companyName: addr.companyName,
		streetAddress1: addr.streetAddress1,
		streetAddress2: addr.streetAddress2,
		city: addr.city,
		cityArea: addr.cityArea,
		postalCode: addr.postalCode,
		country: addr.country.code,
		countryArea: addr.countryArea,
		phone: addr.phone,
	};
}

/** Derive checkout status from Saleor checkout state */
export function mapCheckoutStatus(checkout: SaleorCheckout): CheckoutStatus {
	// If already charged, it's completed
	if (checkout.chargeStatus === "FULL") {
		return "completed";
	}

	// Check if we have enough for payment
	const hasEmail = Boolean(checkout.email);
	const hasShippingAddress = Boolean(checkout.shippingAddress);
	const hasDeliveryMethod = Boolean(checkout.deliveryMethod);
	const hasLines = checkout.lines.length > 0;
	const needsShipping = checkout.isShippingRequired;

	if (!hasLines) {
		return "incomplete";
	}

	if (!hasEmail) {
		return "incomplete";
	}

	if (needsShipping && (!hasShippingAddress || !hasDeliveryMethod)) {
		return "incomplete";
	}

	return "ready_for_payment";
}

/** Map a Saleor shipping method to protocol format */
function mapShippingMethod(method: SaleorShippingMethod): ProtocolShippingMethod {
	return {
		id: method.id,
		name: method.name,
		price: toMinorUnits(method.price),
		...(method.minimumDeliveryDays != null && { estimated_days_min: method.minimumDeliveryDays }),
		...(method.maximumDeliveryDays != null && { estimated_days_max: method.maximumDeliveryDays }),
	};
}

/** Map a full Saleor checkout to protocol format */
export function mapCheckoutToProtocol(checkout: SaleorCheckout): ProtocolCheckout {
	const currency = checkout.totalPrice.gross.currency;

	const lineItems: ProtocolLineItem[] = checkout.lines.map((line) => {
		const image = line.variant.product.thumbnail?.url
			?? line.variant.product.media.find((m) => m.type === "IMAGE")?.url;

		return {
			product_id: line.variant.product.id,
			variant_id: line.variant.id,
			name: `${line.variant.product.name} - ${line.variant.name}`,
			quantity: line.quantity,
			unit_price: toMinorUnits(line.unitPrice.gross),
			total_price: toMinorUnits(line.totalPrice.gross),
			...(image && { image_url: image }),
		};
	});

	const totals: ProtocolTotals = {
		subtotal: toMinorUnits(checkout.subtotalPrice.gross),
		tax: toMinorUnits(checkout.totalPrice.tax),
		shipping: toMinorUnits(checkout.shippingPrice.gross),
		discount: checkout.discount
			? toMinorUnits(checkout.discount)
			: { amount: 0, currency },
		total: toMinorUnits(checkout.totalPrice.gross),
	};

	return {
		id: checkout.id,
		status: mapCheckoutStatus(checkout),
		email: checkout.email,
		line_items: lineItems,
		totals,
		shipping_address: checkout.shippingAddress
			? saleorToProtocol(toSaleorAddress(checkout.shippingAddress))
			: null,
		billing_address: checkout.billingAddress
			? saleorToProtocol(toSaleorAddress(checkout.billingAddress))
			: null,
		delivery_method: checkout.deliveryMethod,
		available_shipping_methods: checkout.shippingMethods.map(mapShippingMethod),
		continue_url: `${STOREFRONT_URL}/checkout?id=${checkout.id}`,
	};
}
