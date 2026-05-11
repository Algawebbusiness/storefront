/**
 * Tests for the C8 Stripe stablecoin handler module.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPaymentHandlersForProfile } from "@/lib/protocols/shared/payment-handlers";
import "@/lib/protocols/handlers/stripe-stablecoin";

describe("stripe-stablecoin handler", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("does not register when STRIPE_ACCEPTED_STABLECOINS is empty", () => {
		vi.stubEnv("STRIPE_ACCEPTED_STABLECOINS", "");
		expect(buildPaymentHandlersForProfile()["com.stripe.stablecoin"]).toBeUndefined();
	});

	it("emits `stablecoin.<coin>` instruments and lowercases coin slugs", () => {
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test");
		vi.stubEnv("STRIPE_ACCEPTED_STABLECOINS", "USDC, USDG");
		vi.stubEnv("STRIPE_STABLECOIN_CHAINS", "ethereum, solana");

		const out = buildPaymentHandlersForProfile();
		expect(out["com.stripe.stablecoin"]).toHaveLength(1);
		const entry = out["com.stripe.stablecoin"]![0]!;
		expect(entry.config.available_payment_instruments).toEqual([
			"stablecoin.usdc",
			"stablecoin.usdg",
		]);
		expect(entry.config.supported_chains).toEqual(["ethereum", "solana"]);
		expect(entry.config.publishable_key).toBe("pk_test");
	});

	it("omits publishable_key when STRIPE_PUBLISHABLE_KEY is unset", () => {
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "");
		vi.stubEnv("STRIPE_ACCEPTED_STABLECOINS", "usdc");
		const entry = buildPaymentHandlersForProfile()["com.stripe.stablecoin"]![0]!;
		expect(entry.config.publishable_key).toBeUndefined();
	});

	it("handles missing chains env as empty list (handler still emits)", () => {
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test");
		vi.stubEnv("STRIPE_ACCEPTED_STABLECOINS", "usdc");
		vi.stubEnv("STRIPE_STABLECOIN_CHAINS", "");
		const entry = buildPaymentHandlersForProfile()["com.stripe.stablecoin"]![0]!;
		expect(entry.config.supported_chains).toEqual([]);
	});
});
