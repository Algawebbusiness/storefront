/**
 * Single cart line row (Phase F6).
 *
 * Thumb + product/variant name + qty stepper + line total. Stepper
 * controls go through `onQtyChange(lineId, newQty)`; the entry forwards
 * to `bridge.callTool("update_cart_line", {...})`. Quantity 0 removes
 * the line server-side (Saleor `checkoutLinesDelete`).
 *
 * Optimistic UI: we don't preempt the server. Stepper clicks fire the
 * tool call; when the host pushes the refreshed `CartPreviewPayload`
 * via `ui/notifications/tool-result`, `CartPreview` re-renders with
 * authoritative totals. Visual delay during the round-trip is part of
 * F6 acceptance; F8 may add a `pending` state.
 */

import type { CartLineSummary } from "../types";

export interface CartLineProps {
	line: CartLineSummary;
	currency: string;
	onQtyChange: (lineId: string, quantity: number) => void;
	disabled?: boolean;
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

export function CartLine({ line, currency, onQtyChange, disabled }: CartLineProps) {
	return (
		<div className="cl-row">
			<div className="cl-thumb">
				{line.thumbnail ? (
					// eslint-disable-next-line @next/next/no-img-element -- iframe bundle
					<img src={line.thumbnail} alt="" loading="lazy" />
				) : (
					<span className="mg-empty">—</span>
				)}
			</div>
			<div className="cl-body">
				<span className="cl-name">{line.productName}</span>
				<span className="cl-variant">{line.variantName}</span>
			</div>
			<div className="cl-controls">
				<div className="cl-stepper" role="group" aria-label="Update quantity">
					<button
						type="button"
						aria-label="Decrease quantity"
						disabled={disabled || line.quantity <= 0}
						onClick={() => onQtyChange(line.id, Math.max(0, line.quantity - 1))}
					>
						−
					</button>
					<span className="cl-stepper__qty" aria-live="polite">
						{line.quantity}
					</span>
					<button
						type="button"
						aria-label="Increase quantity"
						disabled={disabled}
						onClick={() => onQtyChange(line.id, line.quantity + 1)}
					>
						+
					</button>
				</div>
				<span className="cl-line-total">{fmtCurrency(line.lineTotal, currency)}</span>
			</div>
		</div>
	);
}
