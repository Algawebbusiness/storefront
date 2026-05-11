/**
 * Tests for the C6 payment handler registry. Treats the registry as a
 * pure data structure — handlers register, the builder composes, env
 * gating filters out unconfigured handlers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	_resetPaymentHandlerRegistry,
	buildPaymentHandlersForProfile,
	listRegisteredPaymentHandlers,
	registerPaymentHandler,
} from "@/lib/protocols/shared/payment-handlers";

describe("payment-handlers registry", () => {
	beforeEach(() => {
		_resetPaymentHandlerRegistry();
		vi.unstubAllEnvs();
	});

	afterEach(() => {
		_resetPaymentHandlerRegistry();
		vi.unstubAllEnvs();
	});

	it("returns an empty object when no handlers are registered", () => {
		expect(buildPaymentHandlersForProfile()).toEqual({});
		expect(listRegisteredPaymentHandlers()).toEqual([]);
	});

	it("omits handlers whose build() returns null", () => {
		registerPaymentHandler({ id: "com.example.disabled", build: () => null });
		const out = buildPaymentHandlersForProfile();
		expect(out).toEqual({});
	});

	it("includes handlers that return at least one entry", () => {
		registerPaymentHandler({
			id: "com.example.spt",
			build: () => [
				{
					id: "example_spt",
					version: "2026-04-08",
					config: {
						publishable_key: "pk_test",
						available_payment_instruments: ["card"],
					},
				},
			],
		});

		const out = buildPaymentHandlersForProfile();
		expect(Object.keys(out)).toEqual(["com.example.spt"]);
		expect(out["com.example.spt"]).toHaveLength(1);
		expect(out["com.example.spt"]![0]!.id).toBe("example_spt");
	});

	it("dedupes by id when the same handler is registered twice (latest wins)", () => {
		registerPaymentHandler({
			id: "com.example.spt",
			build: () => [
				{
					id: "first",
					version: "2026-04-08",
					config: { available_payment_instruments: ["card"] },
				},
			],
		});
		registerPaymentHandler({
			id: "com.example.spt",
			build: () => [
				{
					id: "second",
					version: "2026-04-08",
					config: { available_payment_instruments: ["card"] },
				},
			],
		});

		expect(listRegisteredPaymentHandlers()).toEqual(["com.example.spt"]);
		const out = buildPaymentHandlersForProfile();
		expect(out["com.example.spt"]![0]!.id).toBe("second");
	});

	it("reads env at build() time so per-deploy configuration is respected", async () => {
		const { default: _ } = await import("@/lib/protocols/handlers/stripe-spt");
		void _;

		// Without STRIPE_PUBLISHABLE_KEY → no entry
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "");
		expect(buildPaymentHandlersForProfile()["com.stripe.shared_payment_token"]).toBeUndefined();

		// With key → single entry, default instruments
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_abc");
		vi.stubEnv("STRIPE_AVAILABLE_INSTRUMENTS", "");
		const out1 = buildPaymentHandlersForProfile();
		expect(out1["com.stripe.shared_payment_token"]![0]!.config.available_payment_instruments).toEqual(["card"]);

		// With env-supplied instruments → custom instruments
		vi.stubEnv("STRIPE_AVAILABLE_INSTRUMENTS", "card, klarna ,affirm");
		const out2 = buildPaymentHandlersForProfile();
		expect(out2["com.stripe.shared_payment_token"]![0]!.config.available_payment_instruments).toEqual([
			"card",
			"klarna",
			"affirm",
		]);
	});
});
