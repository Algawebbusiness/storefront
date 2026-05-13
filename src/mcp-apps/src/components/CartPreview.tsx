/**
 * Cart preview composer (Phase F6).
 *
 * Three sections: header (cart id + warnings), line list (with qty
 * steppers), totals breakdown, and a "Proceed to checkout" CTA gated
 * on `hasEmail && hasShippingAddress`. Delivery-method gating is
 * intentionally NOT enforced here — the model can still legitimately
 * proceed to the summary view to pick one (F7 surface).
 *
 * The Proceed click fires `onProceed(cartId)`. The entry forwards
 * through `bridge.sendUiMessage({kind: "cart.proceed_to_checkout", cart_id})`
 * — typed enum so the iframe never controls the free-form chat string
 * (threat-model §4).
 */

import { CartLine } from "./CartLine";
import { TotalsBlock } from "./TotalsBlock";
import type { CartPreviewPayload } from "../types";

export interface CartPreviewProps {
	payload: CartPreviewPayload | null;
	onQtyChange?: (lineId: string, quantity: number) => void;
	onProceed?: (cartId: string) => void;
}

export function CartPreview({ payload, onQtyChange, onProceed }: CartPreviewProps) {
	if (payload === null) {
		return <div className="pl-loading">Loading cart…</div>;
	}

	if (payload.lines.length === 0) {
		return (
			<div className="cp-root">
				<header className="cp-header">
					<h1>Your cart</h1>
					<span className="cp-header__id">{payload.id}</span>
				</header>
				<div className="cp-empty">Your cart is empty.</div>
			</div>
		);
	}

	const canProceed = payload.hasEmail && payload.hasShippingAddress;
	const proceedHint = canProceed
		? null
		: !payload.hasEmail && !payload.hasShippingAddress
			? "Add an email and shipping address to continue."
			: !payload.hasEmail
				? "Add an email to continue."
				: "Add a shipping address to continue.";

	const handleQtyChange = (lineId: string, quantity: number) => {
		onQtyChange?.(lineId, quantity);
	};

	return (
		<div className="cp-root">
			<header className="cp-header">
				<h1>Your cart ({payload.lines.length})</h1>
				<span className="cp-header__id">{payload.id}</span>
			</header>

			{payload.warnings && payload.warnings.length > 0 && (
				<ul className="cp-warnings" role="alert">
					{payload.warnings.map((w, i) => (
						<li key={`${w.code}-${i}`}>{w.message}</li>
					))}
				</ul>
			)}

			<div className="cl-list">
				{payload.lines.map((line) => (
					<CartLine key={line.id} line={line} currency={payload.currency} onQtyChange={handleQtyChange} />
				))}
			</div>

			<TotalsBlock totals={payload.totals} currency={payload.currency} />

			<button type="button" className="pd-cta" disabled={!canProceed} onClick={() => onProceed?.(payload.id)}>
				{canProceed ? "Proceed to checkout" : "Proceed to checkout"}
			</button>
			{proceedHint && <p className="cp-proceed__hint">{proceedHint}</p>}
		</div>
	);
}
