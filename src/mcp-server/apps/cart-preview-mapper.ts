/**
 * Saleor `Checkout` → iframe `CartPreviewPayload` mapper (Phase F6).
 *
 * Two functions, one shape each:
 *
 *   - `mapCheckoutToCartPreview()`  → `CartPreviewPayload` — the
 *     model-visible payload (no PII). Lines + totals + boolean flags
 *     for "do we have email / address / delivery". Returned by the
 *     paired `get_cart` tool + by `create_checkout` / `get_checkout`.
 *
 *   - `mapCheckoutToCartPreviewFull()` → `CartPreviewFullPayload` —
 *     extends the model shape with `buyer` + `shipping_address` +
 *     `billing_address` (all `customer-pii` class per `data-policy.ts`).
 *     Returned ONLY by `get_cart_full` (`visibility: ["app"]`, hidden
 *     from `tools/list`), called from the iframe via `bridge.fetchAppData`.
 *
 * Currencies on the wire stay major units (e.g. 9.99 USD, not 999¢) —
 * the iframe's `Intl.NumberFormat` rendering wants floating-point input,
 * and we don't want every component reinventing the minor-units
 * conversion (`UcpCartLine.unit_price` keeps minor units for the REST
 * surface; that's untouched).
 *
 * `warnings` echoes whatever the UCP cart-mapper already collected
 * (disclosures, OOS markers, eligibility blockers) — flattened to the
 * minimum shape the iframe needs.
 */

import { mapCheckoutToCart } from "@/lib/protocols/shared/cart-mapper";
import type { SaleorCheckout } from "@/lib/protocols/shared/checkout-queries";
import type {
	CartAddressSummary,
	CartBuyerSummary,
	CartLineSummary,
	CartPreviewFullPayload,
	CartPreviewPayload,
} from "@/mcp-apps/src/types";

function mapLine(line: SaleorCheckout["lines"][number]): CartLineSummary {
	const thumb =
		line.variant.product.thumbnail?.url ??
		line.variant.product.media.find((m) => m.type === "IMAGE")?.url ??
		null;
	return {
		id: line.id,
		variantId: line.variant.id,
		productName: line.variant.product.name,
		variantName: line.variant.name,
		thumbnail: thumb,
		quantity: line.quantity,
		unitPrice: line.unitPrice.gross.amount,
		lineTotal: line.totalPrice.gross.amount,
	};
}

function mapAddress(addr: SaleorCheckout["shippingAddress"]): CartAddressSummary | null {
	if (!addr) return null;
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

function mapBuyer(checkout: SaleorCheckout): CartBuyerSummary {
	const ship = checkout.shippingAddress;
	return {
		email: checkout.email,
		phone: ship?.phone ?? null,
		firstName: ship?.firstName ?? null,
		lastName: ship?.lastName ?? null,
	};
}

/**
 * Build the model-visible cart preview from a Saleor `Checkout`.
 *
 * The `warnings` array is sourced from the existing `mapCheckoutToCart`
 * (UCP cart mapper, Phase A4/C5) — that pipeline already handles
 * disclosure and eligibility surfacing. We project its warning shape to
 * the iframe's leaner `{code, message, line_id?}` form and drop the
 * minor-units totals + protocol-specific fields the iframe doesn't use.
 */
export function mapCheckoutToCartPreview(checkout: SaleorCheckout): CartPreviewPayload {
	const ucpCart = mapCheckoutToCart(checkout);
	const lines = checkout.lines.map(mapLine);

	const totals = {
		subtotal: checkout.subtotalPrice.gross.amount,
		discount: checkout.discount?.amount ?? 0,
		shipping: checkout.shippingPrice.gross.amount,
		tax: checkout.totalPrice.tax.amount,
		total: checkout.totalPrice.gross.amount,
	};

	const warnings = ucpCart.warnings?.map((w) => ({
		code: w.code,
		message: w.message,
		...(w.line_id ? { line_id: w.line_id } : {}),
	}));

	const payload: CartPreviewPayload = {
		id: checkout.id,
		currency: checkout.totalPrice.gross.currency,
		lines,
		totals,
		hasEmail: Boolean(checkout.email),
		hasShippingAddress: Boolean(checkout.shippingAddress),
		hasDeliveryMethod: Boolean(checkout.deliveryMethod),
	};

	if (warnings && warnings.length > 0) {
		payload.warnings = warnings;
	}

	return payload;
}

/**
 * Extend the model-visible payload with buyer + shipping + billing
 * address blocks. Use ONLY in the paired `_full` app-tool handler.
 */
export function mapCheckoutToCartPreviewFull(checkout: SaleorCheckout): CartPreviewFullPayload {
	return {
		...mapCheckoutToCartPreview(checkout),
		buyer: mapBuyer(checkout),
		shipping_address: mapAddress(checkout.shippingAddress),
		billing_address: mapAddress(checkout.billingAddress),
	};
}
