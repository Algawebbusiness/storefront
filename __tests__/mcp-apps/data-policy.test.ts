/**
 * Phase F3 — data-policy table consistency tests.
 *
 * F3 ships only the classification table + helpers; the integration
 * test that runs real mapper output (`mapCheckoutToCart`,
 * `mapOrderToProtocol`) against the table lands in F6/F7 once minimal
 * model-facing mappers exist. For now we verify:
 *   - Every classified path resolves to a valid `DataClass`.
 *   - Wildcards match descendants but not unrelated prefixes.
 *   - `isModelVisibleClass` / `isAppOnlyClass` are exhaustive over the
 *     `DataClass` union.
 *   - `enumerateLeafPaths` walks objects + arrays correctly.
 */

import { describe, expect, it } from "vitest";
import {
	ALL_CLASSIFIED_PATHS,
	APP_ONLY_CLASSES,
	classifyPath,
	enumerateLeafPaths,
	FIELD_CLASSES,
	isAppOnlyClass,
	isModelVisibleClass,
	MODEL_VISIBLE_CLASSES,
	type DataClass,
} from "@/mcp-server/apps/data-policy";

const ALL_DATA_CLASSES: DataClass[] = [
	"public",
	"cart-state",
	"customer-pii",
	"credential",
	"business-confidential",
];

describe("FIELD_CLASSES table", () => {
	it("has at least one entry in every DataClass partition", () => {
		const present = new Set<DataClass>();
		for (const cls of Object.values(FIELD_CLASSES) as DataClass[]) present.add(cls);
		for (const cls of ALL_DATA_CLASSES) {
			expect(present.has(cls), `no fields classified as "${cls}"`).toBe(true);
		}
	});

	it("uses only valid DataClass values", () => {
		const valid = new Set<DataClass>(ALL_DATA_CLASSES);
		for (const [path, cls] of Object.entries(FIELD_CLASSES) as [string, DataClass][]) {
			expect(valid.has(cls), `${path} has invalid class "${cls}"`).toBe(true);
		}
	});

	it("ALL_CLASSIFIED_PATHS mirrors FIELD_CLASSES keys", () => {
		expect([...ALL_CLASSIFIED_PATHS].sort()).toEqual(Object.keys(FIELD_CLASSES).sort());
	});

	it("MODEL_VISIBLE_CLASSES ∪ APP_ONLY_CLASSES + credential covers DataClass", () => {
		const union = new Set([...MODEL_VISIBLE_CLASSES, ...APP_ONLY_CLASSES, "credential"]);
		expect(union.size).toBe(ALL_DATA_CLASSES.length);
	});

	it("isModelVisibleClass + isAppOnlyClass are mutually exclusive", () => {
		for (const cls of ALL_DATA_CLASSES) {
			expect(isModelVisibleClass(cls) && isAppOnlyClass(cls)).toBe(false);
		}
	});

	it("credential is neither model-visible nor app-only (never serialised)", () => {
		expect(isModelVisibleClass("credential")).toBe(false);
		expect(isAppOnlyClass("credential")).toBe(false);
	});
});

describe("classifyPath", () => {
	it("returns exact match before wildcard match", () => {
		expect(classifyPath("cart.lines.productName")).toBe("public");
		expect(classifyPath("cart.lines.quantity")).toBe("cart-state");
	});

	it("falls back to a wildcard parent when no exact match", () => {
		expect(classifyPath("shipping_address.streetAddress1")).toBe("customer-pii");
		expect(classifyPath("shipping_address.country.code")).toBe("customer-pii");
	});

	it("matches the wildcard prefix path itself (e.g. shipping_address)", () => {
		expect(classifyPath("shipping_address")).toBe("customer-pii");
	});

	it("returns undefined for unclassified paths", () => {
		expect(classifyPath("some.unknown.field")).toBeUndefined();
		expect(classifyPath("cart.secret_field")).toBeUndefined();
	});

	it("does NOT match a similarly-named non-descendant", () => {
		// shipping_address.* shouldn't match shipping_addressBackup
		expect(classifyPath("shipping_addressBackup")).toBeUndefined();
	});
});

describe("enumerateLeafPaths", () => {
	it("walks nested objects", () => {
		const paths = [
			...enumerateLeafPaths({
				cart: { id: "c1", totals: { total: 100, currency: "USD" } },
			}),
		];
		expect(paths.sort()).toEqual(["cart.id", "cart.totals.currency", "cart.totals.total"]);
	});

	it("descends into arrays under the same path prefix", () => {
		const paths = [
			...enumerateLeafPaths({
				lines: [
					{ id: "a", qty: 1 },
					{ id: "b", qty: 2 },
				],
			}),
		];
		// Both elements collapse onto `lines.id` + `lines.qty`
		expect(paths.sort()).toEqual(["lines.id", "lines.id", "lines.qty", "lines.qty"]);
	});

	it("yields the path itself for null / empty values", () => {
		const paths = [...enumerateLeafPaths({ a: null, b: {}, c: [] })];
		expect(paths.sort()).toEqual(["a", "b", "c"]);
	});

	it("yields primitives as the prefix itself", () => {
		const paths = [...enumerateLeafPaths({ name: "x", price: 100 })];
		expect(paths.sort()).toEqual(["name", "price"]);
	});
});
