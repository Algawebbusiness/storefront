/**
 * Unit tests for the C4 eligibility framework.
 *
 * Each test installs its own checkers via the public register API and tears
 * them down via `_resetEligibilityCheckers()` so cases don't leak state.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	_registeredCheckerCount,
	_resetEligibilityCheckers,
	checkEligibility,
	registerEligibilityChecker,
	type EligibilityChecker,
} from "@/lib/protocols/shared/eligibility";
import type { UcpCart } from "@/lib/protocols/shared/cart-mapper";

function fakeCart(): UcpCart {
	return {
		id: "cart_1",
		status: "active",
		currency: "USD",
		lines: [
			{
				id: "line_a",
				sku: "SKU-A",
				product_id: "p_a",
				variant_id: "v_a",
				name: "Wine bottle",
				quantity: 2,
				unit_price: { amount: 2500, currency: "USD" },
				total_price: { amount: 5000, currency: "USD" },
			},
		],
		totals: {
			subtotal: { amount: 5000, currency: "USD" },
			tax: { amount: 500, currency: "USD" },
			shipping: { amount: 0, currency: "USD" },
			discount: { amount: 0, currency: "USD" },
			total: { amount: 5500, currency: "USD" },
		},
	};
}

describe("registerEligibilityChecker", () => {
	beforeEach(() => _resetEligibilityCheckers());
	afterEach(() => _resetEligibilityCheckers());

	it("adds and removes checkers", () => {
		const checker: EligibilityChecker = () => [];
		const off = registerEligibilityChecker(checker);
		expect(_registeredCheckerCount()).toBe(1);
		off();
		expect(_registeredCheckerCount()).toBe(0);
	});
});

describe("checkEligibility", () => {
	beforeEach(() => _resetEligibilityCheckers());
	afterEach(() => _resetEligibilityCheckers());

	it("allows the cart when no checkers are registered", () => {
		const result = checkEligibility(fakeCart(), []);
		expect(result.allowed).toBe(true);
		expect(result.missing_requirements).toEqual([]);
	});

	it("blocks when a registered checker surfaces a required requirement", () => {
		registerEligibilityChecker(() => [
			{ type: "age", applies_to: "cart", required: true, message: "Must be 18+" },
		]);
		const result = checkEligibility(fakeCart(), []);
		expect(result.allowed).toBe(false);
		expect(result.missing_requirements).toHaveLength(1);
		expect(result.missing_requirements[0]!.type).toBe("age");
	});

	it("lets a `verified` claim satisfy a required requirement", () => {
		registerEligibilityChecker(() => [
			{ type: "age", applies_to: "cart", required: true, message: "Must be 18+" },
		]);
		const result = checkEligibility(fakeCart(), [
			{ type: "age", status: "verified", evidence: { dob_year: 1990 } },
		]);
		expect(result.allowed).toBe(true);
	});

	it("does NOT let a `claimed` (unverified) claim satisfy a required requirement", () => {
		registerEligibilityChecker(() => [
			{ type: "age", applies_to: "cart", required: true, message: "Must be 18+" },
		]);
		const result = checkEligibility(fakeCart(), [
			{ type: "age", status: "claimed" },
		]);
		expect(result.allowed).toBe(false);
	});

	it("treats a `denied` claim as a hard block even when the requirement is optional", () => {
		registerEligibilityChecker(() => [
			{ type: "region", applies_to: "cart", required: false, message: "EU only" },
		]);
		const result = checkEligibility(fakeCart(), [
			{ type: "region", status: "denied", message: "Shipping unavailable" },
		]);
		expect(result.allowed).toBe(false);
		expect(result.missing_requirements[0]!.type).toBe("region");
	});

	it("calls checkers once per cart plus once per line", () => {
		let cartCalls = 0;
		let lineCalls = 0;
		registerEligibilityChecker((_cart, line) => {
			if (line) lineCalls++;
			else cartCalls++;
			return [];
		});
		checkEligibility(fakeCart(), []);
		expect(cartCalls).toBe(1);
		expect(lineCalls).toBe(1);
	});

	it("preserves registration order of requirements", () => {
		registerEligibilityChecker(() => [
			{ type: "b2b", applies_to: "cart", required: true, message: "IČO required" },
		]);
		registerEligibilityChecker(() => [
			{ type: "age", applies_to: "cart", required: true, message: "18+" },
		]);
		const result = checkEligibility(fakeCart(), []);
		expect(result.missing_requirements.map((r) => r.type)).toEqual(["b2b", "age"]);
	});
});
