/**
 * Shipping method picker (Phase F7).
 *
 * Renders one button per `ShippingMethodOption`. Click fires
 * `onChange(id)`. Parent owns selection. The list comes straight from
 * Saleor's `availableShippingMethods` — no client-side filtering.
 *
 * Estimated delivery range is shown when both ends are present;
 * single-day estimates collapse to "{days} day(s)".
 */

import type { ShippingMethodOption } from "../types";

export interface ShippingPickerProps {
	methods: ShippingMethodOption[];
	selectedId: string | null;
	currency: string;
	onChange: (methodId: string) => void;
}

function formatDays(min: number | null, max: number | null): string {
	if (min === null && max === null) return "";
	if (min !== null && max !== null && min !== max) return `${min}–${max} days`;
	const single = (min ?? max) as number;
	return `${single} day${single === 1 ? "" : "s"}`;
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

export function ShippingPicker({ methods, selectedId, currency, onChange }: ShippingPickerProps) {
	if (methods.length === 0) return null;
	return (
		<div className="sp-root">
			<span className="sp-label">Delivery method</span>
			<div className="sp-list">
				{methods.map((m) => {
					const days = formatDays(m.minDeliveryDays, m.maxDeliveryDays);
					return (
						<button
							key={m.id}
							type="button"
							className="sp-option"
							aria-pressed={m.id === selectedId}
							onClick={() => onChange(m.id)}
						>
							<span>
								<strong>{m.name}</strong>
								{days && <span className="sp-option__meta"> · {days}</span>}
							</span>
							<span>{fmtCurrency(m.price, currency)}</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}
