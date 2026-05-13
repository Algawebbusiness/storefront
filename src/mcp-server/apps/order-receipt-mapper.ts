/**
 * Saleor `Order` → iframe `OrderReceiptPayload` mapper (Phase F7).
 *
 * Two shapes:
 *
 *   - `OrderReceiptPayload`  — 7 model-visible fields per F7 allow-list
 *     (`id, number, status, statusDisplay, currency, total, isPaid`).
 *     `public` + `cart-state` only, per `data-policy.ts`.
 *
 *   - `OrderReceiptFullPayload` — adds the lines list, full totals
 *     breakdown, delivery method name, buyer email, and the
 *     shipping/billing address pair. Returned by `get_order_full`
 *     (`visibility: ["app"]`) only — the model never sees this.
 *
 * Addresses come back in the iframe's `CartAddressSummary` shape
 * (the same one the cart-preview mapper produces) so the iframe can
 * reuse `<AddressBlock />` across F6 and F7 surfaces.
 */

import type { SaleorOrder, SaleorOrderAddress } from "@/lib/protocols/shared/order-queries";
import type {
	CartAddressSummary,
	OrderLineSummary,
	OrderReceiptFullPayload,
	OrderReceiptPayload,
} from "@/mcp-apps/src/types";

function mapAddress(addr: SaleorOrderAddress | null): CartAddressSummary | null {
	if (!addr) return null;
	return {
		firstName: addr.firstName,
		lastName: addr.lastName,
		// Saleor order address payload is leaner than checkout's — fill
		// the missing fields with empty strings so iframe components can
		// trust the shape without branching.
		companyName: "",
		streetAddress1: addr.streetAddress1,
		streetAddress2: addr.streetAddress2,
		city: addr.city,
		cityArea: "",
		postalCode: addr.postalCode,
		country: addr.country.code,
		countryArea: "",
		phone: addr.phone,
	};
}

function mapLine(line: SaleorOrder["lines"][number]): OrderLineSummary {
	return {
		id: line.id,
		productName: line.productName,
		variantName: line.variantName,
		thumbnail: line.thumbnail?.url ?? null,
		quantity: line.quantity,
		unitPrice: line.unitPrice.gross.amount,
		lineTotal: line.totalPrice.gross.amount,
	};
}

export function mapOrderToOrderReceipt(order: SaleorOrder): OrderReceiptPayload {
	return {
		id: order.id,
		number: order.number,
		status: order.status,
		statusDisplay: order.statusDisplay,
		currency: order.total.gross.currency,
		total: order.total.gross.amount,
		isPaid: order.isPaid,
	};
}

export function mapOrderToOrderReceiptFull(order: SaleorOrder): OrderReceiptFullPayload {
	const discount = order.discounts.reduce((acc, d) => acc + d.amount.amount, 0);
	return {
		...mapOrderToOrderReceipt(order),
		created: order.created,
		deliveryMethod: order.deliveryMethod?.name ?? null,
		lines: order.lines.map(mapLine),
		totals: {
			subtotal: order.subtotal.gross.amount,
			discount,
			shipping: order.shippingPrice.gross.amount,
			tax: order.total.tax.amount,
			total: order.total.gross.amount,
		},
		buyer: { email: order.userEmail },
		shipping_address: mapAddress(order.shippingAddress),
		billing_address: mapAddress(order.billingAddress),
	};
}
