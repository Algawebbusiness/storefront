/**
 * Stripe stablecoin handler (Phase C8) — declarative.
 *
 * We advertise stablecoin acceptance in the public UCP profile; Stripe does
 * the actual payment processing on the back end (the UCP-facing flow stays
 * `com.stripe.shared_payment_token` with `payment_method: stablecoin` in
 * the gateway data). The handler is therefore purely a profile-shaping
 * declaration; no new route or processing path needed for C8.
 *
 * Env:
 *   STRIPE_ACCEPTED_STABLECOINS=usdc,usdg
 *   STRIPE_STABLECOIN_CHAINS=ethereum,solana,base
 *
 * Default: empty list → handler omitted. The plan calls this out
 * explicitly: for 99 % of CZ e-shops stablecoin acceptance is not a
 * differentiator, so we don't opt anyone in by default.
 */

import { registerPaymentHandler } from "../shared/payment-handlers";
import { UCP_VERSION } from "../ucp/capabilities";
import type { UcpPaymentHandlerConfig, UcpPaymentInstrument } from "../ucp/types";

registerPaymentHandler({
	id: "com.stripe.stablecoin",
	build: () => {
		const stablecoins = parseList(process.env.STRIPE_ACCEPTED_STABLECOINS);
		if (stablecoins.length === 0) return null;

		const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
		const chains = parseList(process.env.STRIPE_STABLECOIN_CHAINS);

		const config: UcpPaymentHandlerConfig = {
			available_payment_instruments: stablecoins.map(
				(s) => `stablecoin.${s.toLowerCase()}` as UcpPaymentInstrument,
			),
			supported_chains: chains,
		};
		if (publishableKey) config.publishable_key = publishableKey;

		return [
			{
				id: "stripe_stablecoin",
				version: UCP_VERSION,
				config,
			},
		];
	},
});

function parseList(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}
