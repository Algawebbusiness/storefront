/**
 * Stripe Shared Payment Token handler (Phase C6 — extracted from profile-builder).
 *
 * Behavioural contract is identical to the pre-C6 inline definition in
 * profile-builder: when `STRIPE_PUBLISHABLE_KEY` is set, the profile carries
 * a single `com.stripe.shared_payment_token` entry with the publishable key
 * and the available instruments derived from `STRIPE_AVAILABLE_INSTRUMENTS`
 * (default `["card"]`).
 */

import { registerPaymentHandler } from "../shared/payment-handlers";
import { UCP_VERSION } from "../ucp/capabilities";
import type { UcpPaymentInstrument } from "../ucp/types";

const DEFAULT_STRIPE_INSTRUMENTS: UcpPaymentInstrument[] = ["card"];

registerPaymentHandler({
	id: "com.stripe.shared_payment_token",
	build: () => {
		const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
		if (!publishableKey) return null;
		return [
			{
				id: "stripe_spt",
				version: UCP_VERSION,
				config: {
					publishable_key: publishableKey,
					available_payment_instruments: parseStripeInstruments(),
				},
			},
		];
	},
});

/**
 * Parse `STRIPE_AVAILABLE_INSTRUMENTS` env var (comma-separated). Empty /
 * missing → default `["card"]`. Whitespace and empty entries are dropped.
 * Values are not validated against the closed enum subset — the type is
 * open by design (regional instruments like `cz.comgate` may show up).
 */
function parseStripeInstruments(): UcpPaymentInstrument[] {
	const raw = process.env.STRIPE_AVAILABLE_INSTRUMENTS;
	if (!raw) return DEFAULT_STRIPE_INSTRUMENTS;
	const parsed = raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	return parsed.length > 0 ? (parsed as UcpPaymentInstrument[]) : DEFAULT_STRIPE_INSTRUMENTS;
}
