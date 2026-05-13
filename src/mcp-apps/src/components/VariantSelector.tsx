/**
 * Variant pill selector (Phase F5).
 *
 * Renders one pill per `ProductVariantSummary`. Out-of-stock variants
 * stay visible (the model often wants to see them in the conversation)
 * but are `disabled` + strikethroughs so the host can render a clear
 * "this option exists, but not now" affordance.
 *
 * The component is purely controlled — parent owns `selectedId` and
 * the `onChange` callback. F5 surfaces the selection through the
 * `Add to cart` CTA in `ProductDetail`.
 */

import type { ProductVariantSummary } from "../types";

export interface VariantSelectorProps {
	variants: ProductVariantSummary[];
	selectedId: string | null;
	onChange: (variantId: string) => void;
}

export function VariantSelector({ variants, selectedId, onChange }: VariantSelectorProps) {
	if (variants.length === 0) return null;
	return (
		<div className="vs-root">
			<span className="vs-label">Variant</span>
			<div className="vs-pills">
				{variants.map((v) => (
					<button
						key={v.id}
						type="button"
						className="vs-pill"
						aria-pressed={v.id === selectedId}
						disabled={!v.inStock}
						onClick={() => onChange(v.id)}
					>
						{v.name}
					</button>
				))}
			</div>
		</div>
	);
}
