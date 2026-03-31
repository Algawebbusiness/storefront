import { describe, it, expect } from "vitest";
import { toMinorUnits, fromMinorUnits, getCurrencyDecimals } from "@/lib/protocols/shared/money";

describe("Currency conversion — toMinorUnits", () => {
	it("CZK: 520.00 -> 52000", () => {
		expect(toMinorUnits({ amount: 520.0, currency: "CZK" })).toEqual({
			amount: 52000,
			currency: "CZK",
		});
	});

	it("USD: 9.99 -> 999", () => {
		expect(toMinorUnits({ amount: 9.99, currency: "USD" })).toEqual({
			amount: 999,
			currency: "USD",
		});
	});

	it("JPY: 1000 -> 1000 (zero decimals)", () => {
		expect(toMinorUnits({ amount: 1000, currency: "JPY" })).toEqual({
			amount: 1000,
			currency: "JPY",
		});
	});

	it("KWD: 1.234 -> 1234 (three decimals)", () => {
		expect(toMinorUnits({ amount: 1.234, currency: "KWD" })).toEqual({
			amount: 1234,
			currency: "KWD",
		});
	});
});

describe("Currency conversion — fromMinorUnits", () => {
	it("CZK: 52000 -> 520.00", () => {
		expect(fromMinorUnits({ amount: 52000, currency: "CZK" })).toEqual({
			amount: 520.0,
			currency: "CZK",
		});
	});

	it("USD: 999 -> 9.99", () => {
		expect(fromMinorUnits({ amount: 999, currency: "USD" })).toEqual({
			amount: 9.99,
			currency: "USD",
		});
	});

	it("JPY: 1000 -> 1000", () => {
		expect(fromMinorUnits({ amount: 1000, currency: "JPY" })).toEqual({
			amount: 1000,
			currency: "JPY",
		});
	});

	it("KWD: 1234 -> 1.234", () => {
		expect(fromMinorUnits({ amount: 1234, currency: "KWD" })).toEqual({
			amount: 1.234,
			currency: "KWD",
		});
	});

	it("round-trip: fromMinorUnits(toMinorUnits(x)) preserves value", () => {
		const original = { amount: 42.5, currency: "EUR" };
		const roundTripped = fromMinorUnits(toMinorUnits(original));
		expect(roundTripped).toEqual(original);
	});
});

describe("getCurrencyDecimals", () => {
	it("returns 2 for standard currencies (USD, EUR, CZK)", () => {
		expect(getCurrencyDecimals("USD")).toBe(2);
		expect(getCurrencyDecimals("EUR")).toBe(2);
		expect(getCurrencyDecimals("CZK")).toBe(2);
	});

	it("returns 0 for zero-decimal currencies (JPY, KRW, VND)", () => {
		expect(getCurrencyDecimals("JPY")).toBe(0);
		expect(getCurrencyDecimals("KRW")).toBe(0);
		expect(getCurrencyDecimals("VND")).toBe(0);
	});

	it("returns 3 for three-decimal currencies (KWD, BHD, OMR)", () => {
		expect(getCurrencyDecimals("KWD")).toBe(3);
		expect(getCurrencyDecimals("BHD")).toBe(3);
		expect(getCurrencyDecimals("OMR")).toBe(3);
	});

	it("handles lowercase currency codes", () => {
		expect(getCurrencyDecimals("jpy")).toBe(0);
		expect(getCurrencyDecimals("kwd")).toBe(3);
		expect(getCurrencyDecimals("usd")).toBe(2);
	});
});
