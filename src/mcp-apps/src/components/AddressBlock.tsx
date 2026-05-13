/**
 * Read-only address display (Phase F7).
 *
 * Renders a `CartAddressSummary` as a small card. `null` address falls
 * back to a muted placeholder. Used by checkout summary + order receipt.
 *
 * Reads no PII state itself — parent supplies the address (fetched via
 * the paired `_full` tool). The component never calls into the bridge.
 */

import type { CartAddressSummary } from "../types";

export interface AddressBlockProps {
	label: string;
	address: CartAddressSummary | null;
}

export function AddressBlock({ label, address }: AddressBlockProps) {
	return (
		<div className="ab-root">
			<p className="ab-label">{label}</p>
			{address ? (
				<>
					<span className="ab-name">
						{[address.firstName, address.lastName].filter(Boolean).join(" ") || "—"}
					</span>
					{address.companyName && <span className="ab-row">{address.companyName}</span>}
					<span className="ab-row">{address.streetAddress1}</span>
					{address.streetAddress2 && <span className="ab-row">{address.streetAddress2}</span>}
					<span className="ab-row">{[address.postalCode, address.city].filter(Boolean).join(" ")}</span>
					<span className="ab-row">{address.country}</span>
					{address.phone && <span className="ab-row">{address.phone}</span>}
				</>
			) : (
				<span className="ab-empty">Not provided</span>
			)}
		</div>
	);
}
