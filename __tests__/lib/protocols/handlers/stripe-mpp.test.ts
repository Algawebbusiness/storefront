/**
 * Tests for the C9 Stripe MPP handler module — profile-side declaration.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPaymentHandlersForProfile } from "@/lib/protocols/shared/payment-handlers";
import "@/lib/protocols/handlers/stripe-mpp";

describe("stripe-mpp handler", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("does not register when MPP_ENABLED is unset", () => {
		vi.stubEnv("MPP_ENABLED", "");
		expect(buildPaymentHandlersForProfile()["com.stripe.machine_payments"]).toBeUndefined();
	});

	it("emits a mandate-capable handler when MPP_ENABLED is truthy", () => {
		vi.stubEnv("MPP_ENABLED", "true");
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test");
		const entry = buildPaymentHandlersForProfile()["com.stripe.machine_payments"]?.[0];
		expect(entry).toBeDefined();
		expect(entry!.config.protocols).toEqual(["mpp.v1"]);
		expect(entry!.config.supports_streaming).toBe(true);
		expect(entry!.config.supports_recurring).toBe(true);
		expect(entry!.config.supports_micropayments).toBe(true);
		expect(entry!.config.available_payment_instruments).toEqual(["mpp.mandate"]);
		expect(entry!.config.publishable_key).toBe("pk_test");
	});

	it("omits publishable_key when STRIPE_PUBLISHABLE_KEY is unset", () => {
		vi.stubEnv("MPP_ENABLED", "true");
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "");
		const entry = buildPaymentHandlersForProfile()["com.stripe.machine_payments"]?.[0];
		expect(entry).toBeDefined();
		expect(entry!.config.publishable_key).toBeUndefined();
	});
});
