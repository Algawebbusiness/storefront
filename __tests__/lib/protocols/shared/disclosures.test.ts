/**
 * Tests for the C5 disclosures helper + its eligibility checker integration.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	DISCLOSURES,
	_resetDisclosureRegistration,
	attachDisclosureSlugs,
	buildLineDisclosures,
	getDisclosureSlugs,
	registerDisclosureEligibilityChecker,
} from "@/lib/protocols/shared/disclosures";
import {
	_registeredCheckerCount,
	_resetEligibilityCheckers,
	checkEligibility,
} from "@/lib/protocols/shared/eligibility";
import type { UcpCart, UcpCartLine } from "@/lib/protocols/shared/cart-mapper";

function lineWithDisclosures(slugs: string[]) {
	return {
		id: "line_a",
		variant: {
			product: {
				attributes: [
					{ attribute: { slug: "disclosure_type" }, values: slugs.map((s) => ({ slug: s })) },
				],
			},
		},
	};
}

function ucpCart(lineId = "line_a"): UcpCart {
	return {
		id: "cart_1",
		status: "active",
		currency: "USD",
		lines: [
			{
				id: lineId,
				sku: null,
				product_id: "p",
				variant_id: "v",
				name: "Test",
				quantity: 1,
				unit_price: { amount: 1000, currency: "USD" },
				total_price: { amount: 1000, currency: "USD" },
			},
		],
		totals: {
			subtotal: { amount: 1000, currency: "USD" },
			tax: { amount: 0, currency: "USD" },
			shipping: { amount: 0, currency: "USD" },
			discount: { amount: 0, currency: "USD" },
			total: { amount: 1000, currency: "USD" },
		},
	};
}

describe("buildLineDisclosures", () => {
	it("returns warnings for each matched slug", () => {
		const out = buildLineDisclosures(lineWithDisclosures(["alcohol"]));
		expect(out).toHaveLength(1);
		expect(out[0]!.code).toBe("age_restriction");
		expect(out[0]!.message).toMatch(/alkohol/i);
		expect(out[0]!.line_id).toBe("line_a");
	});

	it("ignores unknown disclosure slugs", () => {
		const out = buildLineDisclosures(lineWithDisclosures(["not_a_real_disclosure"]));
		expect(out).toEqual([]);
	});

	it("handles multiple disclosures on one line", () => {
		const out = buildLineDisclosures(lineWithDisclosures(["alcohol", "dietary_supplement"]));
		expect(out.map((w) => w.code).sort()).toEqual(["age_restriction", "regulatory_disclosure"]);
	});

	it("returns [] for a line with no disclosure attribute", () => {
		expect(buildLineDisclosures({ id: "x", variant: { product: { attributes: [] } } })).toEqual([]);
	});
});

describe("attachDisclosureSlugs + getDisclosureSlugs", () => {
	it("roundtrips a list of slugs without affecting the JSON shape", () => {
		const line: UcpCartLine = {
			id: "line_a",
			sku: null,
			product_id: "p",
			variant_id: "v",
			name: "Wine",
			quantity: 1,
			unit_price: { amount: 100, currency: "USD" },
			total_price: { amount: 100, currency: "USD" },
		};
		attachDisclosureSlugs(line, ["alcohol"]);
		expect(getDisclosureSlugs(line)).toEqual(["alcohol"]);
		// Serialised JSON must not expose the symbol-keyed property.
		expect(JSON.parse(JSON.stringify(line))).not.toHaveProperty("alcohol");
	});
});

describe("registerDisclosureEligibilityChecker (integration with eligibility)", () => {
	beforeEach(() => {
		_resetEligibilityCheckers();
		_resetDisclosureRegistration();
	});

	afterEach(() => {
		_resetEligibilityCheckers();
		_resetDisclosureRegistration();
	});

	it("registers exactly once even when called multiple times", () => {
		registerDisclosureEligibilityChecker();
		registerDisclosureEligibilityChecker();
		registerDisclosureEligibilityChecker();
		expect(_registeredCheckerCount()).toBe(1);
	});

	it("emits an age:18+ requirement for an alcohol-flagged cart line", () => {
		registerDisclosureEligibilityChecker();
		const cart = ucpCart();
		attachDisclosureSlugs(cart.lines[0]!, ["alcohol"]);

		const result = checkEligibility(cart, []);
		expect(result.allowed).toBe(false);
		expect(result.missing_requirements).toHaveLength(1);
		expect(result.missing_requirements[0]!.type).toBe("age");
		expect(result.missing_requirements[0]!.applies_to).toBe("line");
		expect(result.missing_requirements[0]!.applies_to_id).toBe("line_a");
	});

	it("allows the cart once an age:verified claim is supplied", () => {
		registerDisclosureEligibilityChecker();
		const cart = ucpCart();
		attachDisclosureSlugs(cart.lines[0]!, ["alcohol"]);

		const result = checkEligibility(cart, [
			{ type: "age", status: "verified", evidence: { dob_year: 1980 } },
		]);
		expect(result.allowed).toBe(true);
	});

	it("does NOT flag dietary_supplement (no requires_eligibility)", () => {
		registerDisclosureEligibilityChecker();
		const cart = ucpCart();
		attachDisclosureSlugs(cart.lines[0]!, ["dietary_supplement"]);

		const result = checkEligibility(cart, []);
		expect(result.allowed).toBe(true);
		expect(result.missing_requirements).toEqual([]);
	});
});

describe("DISCLOSURES table", () => {
	it("includes the documented categories", () => {
		expect(Object.keys(DISCLOSURES).sort()).toEqual([
			"alcohol",
			"dietary_supplement",
			"electronics_recycling",
			"medical_device_class_i",
		]);
	});
});
