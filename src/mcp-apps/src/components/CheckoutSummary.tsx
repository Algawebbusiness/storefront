/**
 * Pre-pay checkout summary view (Phase F7).
 *
 * Composes the model-visible `CheckoutSummaryPayload` plus the
 * iframe-fetched `CheckoutSummaryFullPayload` (addresses + buyer) when
 * available. Layout:
 *
 *   1. Header (cart id, warnings)
 *   2. Shipping + billing address blocks (rendered from full payload)
 *   3. Shipping method picker (model payload's `availableShippingMethods`)
 *   4. Line list (compact — reuses F6 line layout)
 *   5. Totals breakdown
 *   6. Confirm & pay CTA — fires `onConfirm(checkout_id)`, which the
 *      entry routes through `bridge.sendUiMessage({kind:
 *      "checkout.confirm_requested", checkout_id})`. The iframe never
 *      sees the payment token (threat-model §3 credential boundary).
 */

import { AddressBlock } from "./AddressBlock";
import { CartLine } from "./CartLine";
import { ShippingPicker } from "./ShippingPicker";
import { TotalsBlock } from "./TotalsBlock";
import type { CheckoutSummaryFullPayload, CheckoutSummaryPayload } from "../types";

export interface CheckoutSummaryProps {
	payload: CheckoutSummaryPayload | null;
	fullPayload?: CheckoutSummaryFullPayload | null;
	onSelectShipping?: (methodId: string) => void;
	onConfirm?: (checkoutId: string) => void;
}

export function CheckoutSummary({ payload, fullPayload, onSelectShipping, onConfirm }: CheckoutSummaryProps) {
	if (payload === null) {
		return <div className="pl-loading">Loading checkout…</div>;
	}

	const canConfirm = payload.hasEmail && payload.hasShippingAddress && payload.hasDeliveryMethod;
	const proceedHint = canConfirm
		? null
		: !payload.hasShippingAddress
			? "Add a shipping address to continue."
			: !payload.hasEmail
				? "Add an email to continue."
				: "Pick a delivery method to continue.";

	const shipping = fullPayload?.shipping_address ?? null;
	const billing = fullPayload?.billing_address ?? null;

	return (
		<div className="cs-root">
			<header className="cp-header">
				<h1>Review &amp; pay</h1>
				<span className="cp-header__id">{payload.id}</span>
			</header>

			{payload.warnings && payload.warnings.length > 0 && (
				<ul className="cp-warnings" role="alert">
					{payload.warnings.map((w, i) => (
						<li key={`${w.code}-${i}`}>{w.message}</li>
					))}
				</ul>
			)}

			<p className="cs-section-label">Addresses</p>
			<div className="or-grid or-grid--two-col">
				<AddressBlock label="Shipping" address={shipping} />
				<AddressBlock label="Billing" address={billing} />
			</div>

			<ShippingPicker
				methods={payload.availableShippingMethods}
				selectedId={payload.selectedDeliveryMethod?.id ?? null}
				currency={payload.currency}
				onChange={(methodId) => onSelectShipping?.(methodId)}
			/>

			<p className="cs-section-label">Items</p>
			<div className="cl-list">
				{payload.lines.map((line) => (
					<CartLine
						key={line.id}
						line={line}
						currency={payload.currency}
						onQtyChange={() => undefined}
						disabled
					/>
				))}
			</div>

			<TotalsBlock totals={payload.totals} currency={payload.currency} />

			<button
				type="button"
				className="pd-cta cs-confirm"
				disabled={!canConfirm}
				onClick={() => onConfirm?.(payload.id)}
			>
				Confirm &amp; pay
			</button>
			{proceedHint && <p className="cp-proceed__hint">{proceedHint}</p>}
		</div>
	);
}
