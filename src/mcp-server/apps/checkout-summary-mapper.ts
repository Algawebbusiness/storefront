/**
 * Saleor `Checkout` → iframe `CheckoutSummaryPayload` mapper (Phase F7).
 *
 * Pre-pay review view shape. Diff vs the F6 cart preview:
 *   - adds `selectedDeliveryMethod` (id + name, `cart-state` class) and
 *     `availableShippingMethods` (full picker entries, `public` class).
 *   - drops the cart's `discount` summary in favor of the totals row
 *     (parity with `OrderReceipt` later) — `discount` still lives in
 *     `totals.discount` so the UI can render the −line.
 *
 * Buyer + addresses are restricted to the paired `_full` variant, same
 * convention as F6. Iframe pulls full via `bridge.fetchAppData("get_checkout")`.
 */

import type { SaleorCheckout } from "@/lib/protocols/shared/checkout-queries";
import type {
	CartLineSummary,
	CheckoutSummaryFullPayload,
	CheckoutSummaryPayload,
	ShippingMethodOption,
} from "@/mcp-apps/src/types";
import { mapCheckoutToCartPreview, mapCheckoutToCartPreviewFull } from "./cart-preview-mapper";

function mapShippingMethod(m: SaleorCheckout["shippingMethods"][number]): ShippingMethodOption {
	return {
		id: m.id,
		name: m.name,
		price: m.price.amount,
		minDeliveryDays: m.minimumDeliveryDays,
		maxDeliveryDays: m.maximumDeliveryDays,
	};
}

function projectLines(lines: CartLineSummary[]): CartLineSummary[] {
	// F7 keeps the same line shape as F6 — separating the mapper hop
	// keeps each F-step's mapper a one-line change away from a future
	// shape divergence (e.g. when a Saleor variant flag needs to land
	// only in the summary view).
	return lines;
}

export function mapCheckoutToCheckoutSummary(checkout: SaleorCheckout): CheckoutSummaryPayload {
	const cart = mapCheckoutToCartPreview(checkout);
	const selectedDeliveryMethod = checkout.deliveryMethod
		? { id: checkout.deliveryMethod.id, name: checkout.deliveryMethod.name }
		: null;

	const summary: CheckoutSummaryPayload = {
		id: cart.id,
		currency: cart.currency,
		lines: projectLines(cart.lines),
		totals: cart.totals,
		selectedDeliveryMethod,
		availableShippingMethods: checkout.shippingMethods.map(mapShippingMethod),
		hasEmail: cart.hasEmail,
		hasShippingAddress: cart.hasShippingAddress,
		hasDeliveryMethod: cart.hasDeliveryMethod,
	};

	if (cart.warnings && cart.warnings.length > 0) {
		summary.warnings = cart.warnings;
	}
	return summary;
}

export function mapCheckoutToCheckoutSummaryFull(checkout: SaleorCheckout): CheckoutSummaryFullPayload {
	const summary = mapCheckoutToCheckoutSummary(checkout);
	const full = mapCheckoutToCartPreviewFull(checkout);
	return {
		...summary,
		buyer: full.buyer,
		shipping_address: full.shipping_address,
		billing_address: full.billing_address,
	};
}
