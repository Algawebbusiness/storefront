/**
 * Cart / checkout totals breakdown (Phase F6, reused by F7).
 *
 * Renders a small two-column grid with subtotal, discount, shipping,
 * tax, and total rows. Zero-valued rows are still shown to keep the
 * layout stable across re-renders — the cart payload always carries
 * all five fields (mapped from Saleor or defaulted to 0 in
 * `cart-preview-mapper.ts`).
 */

import type { CartPreviewPayload } from "../types";

export interface TotalsBlockProps {
	totals: CartPreviewPayload["totals"];
	currency: string;
}

function fmtCurrency(amount: number, currency: string): string {
	try {
		return new Intl.NumberFormat(undefined, {
			style: "currency",
			currency: currency || "USD",
			maximumFractionDigits: 2,
		}).format(amount);
	} catch {
		return `${amount.toFixed(2)} ${currency}`.trim();
	}
}

export function TotalsBlock({ totals, currency }: TotalsBlockProps) {
	return (
		<div className="tb-root">
			<span className="tb-label">Subtotal</span>
			<span className="tb-value">{fmtCurrency(totals.subtotal, currency)}</span>
			<span className="tb-label">Discount</span>
			<span className="tb-value">−{fmtCurrency(totals.discount, currency)}</span>
			<span className="tb-label">Shipping</span>
			<span className="tb-value">{fmtCurrency(totals.shipping, currency)}</span>
			<span className="tb-label">Tax</span>
			<span className="tb-value">{fmtCurrency(totals.tax, currency)}</span>
			<span className="tb-label tb-total">Total</span>
			<span className="tb-value tb-total">{fmtCurrency(totals.total, currency)}</span>
		</div>
	);
}
