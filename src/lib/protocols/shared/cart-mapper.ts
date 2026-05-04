/**
 * Maps Saleor `Checkout` to the UCP `cart` shape (Phase A4).
 *
 * UCP cart and UCP checkout-session are two different protocol concepts but they
 * share the same Saleor backend object: `Checkout` in pre-`checkoutComplete`
 * state. The cart shape is leaner — no shipping/billing addresses, no delivery
 * method, no continue_url. It exposes a SKU per line and a top-level currency.
 *
 * Per UCP 2026-04-08, `currency` is mandatory at the top level even for empty
 * carts. We derive it from `checkout.totalPrice.gross.currency`, which Saleor
 * always populates from the channel default.
 */

import { toMinorUnits } from "./money";
import type { SaleorCheckout } from "./checkout-queries";
import type { ProtocolMoney } from "./types";

/** UCP cart line — one product variant with a quantity */
export interface UcpCartLine {
	id: string;
	sku: string | null;
	product_id: string;
	variant_id: string;
	name: string;
	quantity: number;
	unit_price: ProtocolMoney;
	total_price: ProtocolMoney;
	image_url?: string;
}

/** UCP cart totals — same shape as protocol totals but with explicit names */
export interface UcpCartTotals {
	subtotal: ProtocolMoney;
	tax: ProtocolMoney;
	shipping: ProtocolMoney;
	discount: ProtocolMoney;
	total: ProtocolMoney;
}

/** Discount voucher applied to a cart */
export interface UcpAppliedDiscount {
	amount: ProtocolMoney;
}

/** Cart-level warning (e.g. stock issues, price changes) */
export interface UcpCartWarning {
	code: string;
	message: string;
	line_id?: string;
}

/** Cart status — only "active" or "cancelled" at the cart layer; checkout flow takes over after that. */
export type UcpCartStatus = "active" | "cancelled";

/** UCP cart — agent's view of an in-progress shopping cart. */
export interface UcpCart {
	id: string;
	status: UcpCartStatus;
	currency: string;
	lines: UcpCartLine[];
	totals: UcpCartTotals;
	applied_discounts?: UcpAppliedDiscount[];
	warnings?: UcpCartWarning[];
}

/** Map a Saleor Checkout into the UCP cart shape. */
export function mapCheckoutToCart(
	checkout: SaleorCheckout,
	options: { status?: UcpCartStatus } = {},
): UcpCart {
	const currency = checkout.totalPrice.gross.currency;

	const lines: UcpCartLine[] = checkout.lines.map((line) => {
		const image =
			line.variant.product.thumbnail?.url ?? line.variant.product.media.find((m) => m.type === "IMAGE")?.url;

		return {
			id: line.id,
			sku: line.variant.sku,
			product_id: line.variant.product.id,
			variant_id: line.variant.id,
			name: `${line.variant.product.name} - ${line.variant.name}`,
			quantity: line.quantity,
			unit_price: toMinorUnits(line.unitPrice.gross),
			total_price: toMinorUnits(line.totalPrice.gross),
			...(image ? { image_url: image } : {}),
		};
	});

	const totals: UcpCartTotals = {
		subtotal: toMinorUnits(checkout.subtotalPrice.gross),
		tax: toMinorUnits(checkout.totalPrice.tax),
		shipping: toMinorUnits(checkout.shippingPrice.gross),
		discount: checkout.discount ? toMinorUnits(checkout.discount) : { amount: 0, currency },
		total: toMinorUnits(checkout.totalPrice.gross),
	};

	const cart: UcpCart = {
		id: checkout.id,
		status: options.status ?? "active",
		currency,
		lines,
		totals,
	};

	if (checkout.discount && checkout.discount.amount > 0) {
		cart.applied_discounts = [{ amount: toMinorUnits(checkout.discount) }];
	}

	return cart;
}
