/**
 * Maps Saleor order state to protocol format (used by both ACP and UCP).
 */

import type { ProtocolAddress, ProtocolLineItem, ProtocolMoney, ProtocolTotals } from "./types";
import type { SaleorOrder, SaleorOrderAddress } from "./order-queries";
import { toMinorUnits } from "./money";

const STOREFRONT_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL || "http://localhost:3000";

/** Order status in protocol format */
export type ProtocolOrderStatus =
	| "pending"
	| "processing"
	| "shipped"
	| "delivered"
	| "cancelled"
	| "refunded";

/** Full protocol order representation */
export interface ProtocolOrder {
	id: string;
	number: string;
	status: ProtocolOrderStatus;
	status_display: string;
	created_at: string;
	email: string | null;
	is_paid: boolean;
	line_items: ProtocolLineItem[];
	totals: ProtocolTotals;
	shipping_address: ProtocolAddress | null;
	billing_address: ProtocolAddress | null;
	shipping_method: { name: string; price: ProtocolMoney } | null;
	discounts: Array<{ name: string; amount: ProtocolMoney }>;
	continue_url: string;
}

/** Map Saleor order status string to protocol status enum */
export function mapSaleorOrderStatus(status: string): ProtocolOrderStatus {
	const upper = status.toUpperCase();

	switch (upper) {
		case "DRAFT":
		case "UNCONFIRMED":
			return "pending";
		case "UNFULFILLED":
		case "PARTIALLY_FULFILLED":
			return "processing";
		case "FULFILLED":
		case "PARTIALLY_RETURNED":
			return "shipped";
		case "RETURNED":
			return "delivered";
		case "CANCELED":
			return "cancelled";
		case "REFUNDED":
			return "refunded";
		default:
			return "processing";
	}
}

/** Convert a Saleor order address to protocol format */
function mapOrderAddress(addr: SaleorOrderAddress): ProtocolAddress {
	return {
		street_address: addr.streetAddress1,
		...(addr.streetAddress2 && { street_address_2: addr.streetAddress2 }),
		address_locality: addr.city,
		postal_code: addr.postalCode,
		address_country: addr.country.code,
	};
}

/** Map a full Saleor order to protocol format */
export function mapOrderToProtocol(order: SaleorOrder): ProtocolOrder {
	const currency = order.total.gross.currency;

	const lineItems: ProtocolLineItem[] = order.lines.map((line) => ({
		// Order lines don't have separate product/variant IDs, use line ID
		product_id: line.id,
		variant_id: line.id,
		name: line.variantName
			? `${line.productName} - ${line.variantName}`
			: line.productName,
		quantity: line.quantity,
		unit_price: toMinorUnits(line.unitPrice.gross),
		total_price: toMinorUnits(line.totalPrice.gross),
		...(line.thumbnail && { image_url: line.thumbnail.url }),
	}));

	// Calculate total discount from all discount entries
	const totalDiscountAmount = order.discounts.reduce(
		(sum, d) => sum + d.amount.amount,
		0,
	);

	const totals: ProtocolTotals = {
		subtotal: toMinorUnits(order.subtotal.gross),
		tax: toMinorUnits(order.total.tax),
		shipping: toMinorUnits(order.shippingPrice.gross),
		discount: toMinorUnits({ amount: totalDiscountAmount, currency }),
		total: toMinorUnits(order.total.gross),
	};

	return {
		id: order.id,
		number: order.number,
		status: mapSaleorOrderStatus(order.status),
		status_display: order.statusDisplay,
		created_at: order.created,
		email: order.userEmail,
		is_paid: order.isPaid,
		line_items: lineItems,
		totals,
		shipping_address: order.shippingAddress
			? mapOrderAddress(order.shippingAddress)
			: null,
		billing_address: order.billingAddress
			? mapOrderAddress(order.billingAddress)
			: null,
		shipping_method: order.deliveryMethod
			? {
					name: order.deliveryMethod.name,
					price: toMinorUnits(order.shippingPrice.gross),
				}
			: null,
		discounts: order.discounts.map((d) => ({
			name: d.name ?? "Discount",
			amount: toMinorUnits(d.amount),
		})),
		continue_url: `${STOREFRONT_URL}/orders/${order.number}`,
	};
}
