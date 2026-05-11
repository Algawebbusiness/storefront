/**
 * Stripe Machine Payments Protocol (MPP) handler skeleton (Phase C9).
 *
 * MPP is Stripe + Tempo's recurring/streaming/micro-payment protocol — agents
 * obtain a *mandate* once and then debit it on a schedule (subscriptions,
 * usage-based billing, per-token AI charges). The full E7 pilot wires this
 * into Saleor's subscription engine; C9 only ships the declaration + a
 * mandate creation endpoint so agents can probe and reserve mandate IDs.
 *
 * Env:
 *   MPP_ENABLED=true            — opt-in flag.
 *   STRIPE_PUBLISHABLE_KEY      — already required by the other Stripe handlers.
 */

import { registerPaymentHandler } from "../shared/payment-handlers";
import { UCP_VERSION } from "../ucp/capabilities";

registerPaymentHandler({
	id: "com.stripe.machine_payments",
	build: () => {
		const enabled = process.env.MPP_ENABLED;
		if (!isEnabled(enabled)) return null;
		const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;

		return [
			{
				id: "stripe_mpp",
				version: UCP_VERSION,
				config: {
					available_payment_instruments: ["mpp.mandate"],
					...(publishableKey ? { publishable_key: publishableKey } : {}),
					protocols: ["mpp.v1"],
					supports_streaming: true,
					supports_recurring: true,
					supports_micropayments: true,
				},
			},
		];
	},
});

function isEnabled(raw: string | undefined): boolean {
	if (!raw) return false;
	const normalised = raw.trim().toLowerCase();
	return normalised === "true" || normalised === "1" || normalised === "yes";
}
