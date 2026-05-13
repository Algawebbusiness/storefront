/**
 * Post-pay order receipt (Phase F7).
 *
 * Renders the model-visible `OrderReceiptPayload` (header: number,
 * status, total) and — when the iframe has fetched the paired full
 * payload via `bridge.fetchAppData("get_order", {order_id})` — the
 * line list, totals breakdown, and address block.
 *
 * "View order" button forwards through `onViewOrder(orderId)`; the entry
 * builds the URL from `window.__BRAND__` (or a sensible default) and
 * calls `bridge.openLink(url)`.
 */

import { AddressBlock } from "./AddressBlock";
import { TotalsBlock } from "./TotalsBlock";
import type { OrderReceiptFullPayload, OrderReceiptPayload } from "../types";

export interface OrderReceiptProps {
	payload: OrderReceiptPayload | null;
	fullPayload?: OrderReceiptFullPayload | null;
	onViewOrder?: (orderId: string) => void;
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

export function OrderReceipt({ payload, fullPayload, onViewOrder }: OrderReceiptProps) {
	if (payload === null) {
		return <div className="pl-loading">Loading order…</div>;
	}

	const statusClass = payload.isPaid ? "or-status" : "or-status or-status--unpaid";

	return (
		<div className="or-root">
			<header className="or-header">
				<span className={statusClass}>{payload.statusDisplay || payload.status}</span>
				<h1 className="or-number">Order #{payload.number}</h1>
				<span className="or-total">{fmtCurrency(payload.total, payload.currency)}</span>
				<button type="button" className="or-view-order" onClick={() => onViewOrder?.(payload.id)}>
					View order
				</button>
			</header>

			{fullPayload?.lines && fullPayload.lines.length > 0 && (
				<>
					<p className="cs-section-label">Items</p>
					<div className="cl-list">
						{fullPayload.lines.map((l) => (
							<div className="cl-row" key={l.id}>
								<div className="cl-thumb">
									{l.thumbnail ? (
										// eslint-disable-next-line @next/next/no-img-element -- iframe bundle
										<img src={l.thumbnail} alt="" loading="lazy" />
									) : (
										<span className="mg-empty">—</span>
									)}
								</div>
								<div className="cl-body">
									<span className="cl-name">{l.productName}</span>
									<span className="cl-variant">
										{l.variantName} · ×{l.quantity}
									</span>
								</div>
								<span className="cl-line-total">{fmtCurrency(l.lineTotal, payload.currency)}</span>
							</div>
						))}
					</div>
				</>
			)}

			{fullPayload?.totals && <TotalsBlock totals={fullPayload.totals} currency={payload.currency} />}

			{(fullPayload?.shipping_address || fullPayload?.billing_address) && (
				<>
					<p className="cs-section-label">Addresses</p>
					<div className="or-grid or-grid--two-col">
						<AddressBlock label="Shipping" address={fullPayload?.shipping_address ?? null} />
						<AddressBlock label="Billing" address={fullPayload?.billing_address ?? null} />
					</div>
				</>
			)}
		</div>
	);
}
