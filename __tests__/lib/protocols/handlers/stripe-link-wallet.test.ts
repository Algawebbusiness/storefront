/**
 * Tests for the C7 Stripe Link wallet handler module.
 *
 * Verifies env gating: handler only emits when both STRIPE_PUBLISHABLE_KEY
 * and STRIPE_LINK_WALLET_ENABLED are set. Truthy values: true / 1 / yes.
 *
 * The handler self-registers on module load (side-effect import below).
 * Tests share the registration and only flip env vars between cases.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPaymentHandlersForProfile } from "@/lib/protocols/shared/payment-handlers";
import "@/lib/protocols/handlers/stripe-link-wallet";

describe("stripe-link-wallet handler", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("does not register when STRIPE_LINK_WALLET_ENABLED is unset", () => {
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test");
		vi.stubEnv("STRIPE_LINK_WALLET_ENABLED", "");
		const out = buildPaymentHandlersForProfile();
		expect(out["com.stripe.link_agent_wallet"]).toBeUndefined();
	});

	it("does not register when STRIPE_PUBLISHABLE_KEY is missing", () => {
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "");
		vi.stubEnv("STRIPE_LINK_WALLET_ENABLED", "true");
		const out = buildPaymentHandlersForProfile();
		expect(out["com.stripe.link_agent_wallet"]).toBeUndefined();
	});

	it("emits a wallet.link instrument when both env vars are set", () => {
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test");
		vi.stubEnv("STRIPE_LINK_WALLET_ENABLED", "true");
		const out = buildPaymentHandlersForProfile();
		expect(out["com.stripe.link_agent_wallet"]).toHaveLength(1);
		const entry = out["com.stripe.link_agent_wallet"]![0]!;
		expect(entry.id).toBe("stripe_link");
		expect(entry.config.publishable_key).toBe("pk_test");
		expect(entry.config.available_payment_instruments).toEqual(["wallet.link"]);
	});

	it("accepts truthy values 1 / yes / TRUE for STRIPE_LINK_WALLET_ENABLED", () => {
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test");
		for (const v of ["1", "yes", "TRUE", "True"]) {
			vi.stubEnv("STRIPE_LINK_WALLET_ENABLED", v);
			expect(buildPaymentHandlersForProfile()["com.stripe.link_agent_wallet"]).toHaveLength(1);
		}
	});

	it("rejects falsy strings like 0 / false / off", () => {
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test");
		for (const v of ["0", "false", "off", "no"]) {
			vi.stubEnv("STRIPE_LINK_WALLET_ENABLED", v);
			expect(buildPaymentHandlersForProfile()["com.stripe.link_agent_wallet"]).toBeUndefined();
		}
	});
});
