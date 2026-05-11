/**
 * Stripe Link Agent Wallet handler (Phase C7).
 *
 * Stripe Sessions 2026 introduced the "Link wallet" — a customer-owned
 * payment credential the agent can carry on the customer's behalf. The
 * handler self-registers when both `STRIPE_PUBLISHABLE_KEY` and
 * `STRIPE_LINK_WALLET_ENABLED` are set.
 *
 * The wire format from agent → checkout complete:
 *
 *   {
 *     "payment": {
 *       "type": "com.stripe.link_agent_wallet",
 *       "token": "<stripe link wallet token>"
 *     }
 *   }
 *
 * Server-side handling is in `shared/payment.ts` — processStripePayment
 * receives the token + paymentMethod="link_wallet" and forwards it to
 * Saleor's `transactionInitialize` with the right gateway data shape.
 *
 * Note: the precise Stripe Link wallet token schema for 2026 is still
 * being finalised. The handler advertises the capability today; the
 * server-side mapping in payment.ts uses a generic `linkWalletToken`
 * gateway-data key that we'll align with the final spec when published.
 */

import { registerPaymentHandler } from "../shared/payment-handlers";
import { UCP_VERSION } from "../ucp/capabilities";
import type { UcpPaymentInstrument } from "../ucp/types";

registerPaymentHandler({
	id: "com.stripe.link_agent_wallet",
	build: () => {
		const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
		const enabled = process.env.STRIPE_LINK_WALLET_ENABLED;
		if (!publishableKey) return null;
		if (!isEnabled(enabled)) return null;

		const linkInstrument: UcpPaymentInstrument = "wallet.link";

		return [
			{
				id: "stripe_link",
				version: UCP_VERSION,
				config: {
					publishable_key: publishableKey,
					available_payment_instruments: [linkInstrument],
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
