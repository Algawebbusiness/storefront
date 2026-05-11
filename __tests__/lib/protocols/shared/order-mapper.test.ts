import { describe, expect, it } from "vitest";
import { mapOrderToProtocol } from "@/lib/protocols/shared/order-mapper";
import type { SaleorOrder } from "@/lib/protocols/shared/order-queries";

function makeOrder(overrides: Partial<SaleorOrder> = {}): SaleorOrder {
	const base: SaleorOrder = {
		id: "ord_1",
		number: "100001",
		status: "UNFULFILLED",
		statusDisplay: "Unfulfilled",
		created: "2026-05-11T10:00:00Z",
		userEmail: "buyer@example.com",
		isPaid: true,
		lines: [],
		total: {
			gross: { amount: 599, currency: "CZK" },
			tax: { amount: 99, currency: "CZK" },
		},
		subtotal: { gross: { amount: 500, currency: "CZK" } },
		shippingPrice: { gross: { amount: 99, currency: "CZK" } },
		shippingAddress: null,
		billingAddress: null,
		deliveryMethod: null,
		discounts: [],
	};
	return { ...base, ...overrides };
}

describe("mapOrderToProtocol — UCP 2026-04-08 totals contract", () => {
	it("emits currency on order top-level", () => {
		const order = mapOrderToProtocol(makeOrder());
		expect(order.currency).toBe("CZK");
	});

	it("totals carry mandatory currency + integer cents fields", () => {
		const order = mapOrderToProtocol(makeOrder());
		expect(order.totals).toEqual({
			currency: "CZK",
			subtotal_cents: 50000,
			discount_cents: 0,
			shipping_cents: 9900,
			tax_cents: 9900,
			total_cents: 59900,
		});
		expect(Number.isInteger(order.totals.subtotal_cents)).toBe(true);
		expect(Number.isInteger(order.totals.total_cents)).toBe(true);
	});

	it("normalizes a lowercased currency to uppercase ISO 4217", () => {
		const order = mapOrderToProtocol(
			makeOrder({
				total: { gross: { amount: 100, currency: "czk" }, tax: { amount: 0, currency: "czk" } },
				subtotal: { gross: { amount: 100, currency: "czk" } },
				shippingPrice: { gross: { amount: 0, currency: "czk" } },
			}),
		);
		expect(order.currency).toBe("CZK");
		expect(order.totals.currency).toBe("CZK");
	});

	it("zero-decimal currency (JPY): 1000 stays 1000 cents", () => {
		const order = mapOrderToProtocol(
			makeOrder({
				total: {
					gross: { amount: 1000, currency: "JPY" },
					tax: { amount: 0, currency: "JPY" },
				},
				subtotal: { gross: { amount: 1000, currency: "JPY" } },
				shippingPrice: { gross: { amount: 0, currency: "JPY" } },
			}),
		);
		expect(order.totals).toEqual({
			currency: "JPY",
			subtotal_cents: 1000,
			discount_cents: 0,
			shipping_cents: 0,
			tax_cents: 0,
			total_cents: 1000,
		});
	});

	it("three-decimal currency (KWD): 1.234 → 1234", () => {
		const order = mapOrderToProtocol(
			makeOrder({
				total: {
					gross: { amount: 1.234, currency: "KWD" },
					tax: { amount: 0, currency: "KWD" },
				},
				subtotal: { gross: { amount: 1.234, currency: "KWD" } },
				shippingPrice: { gross: { amount: 0, currency: "KWD" } },
			}),
		);
		expect(order.totals.subtotal_cents).toBe(1234);
		expect(order.totals.total_cents).toBe(1234);
	});

	it("aggregates multiple discount entries into a single discount_cents", () => {
		const order = mapOrderToProtocol(
			makeOrder({
				discounts: [
					{ name: "10% off", amount: { amount: 50, currency: "CZK" } },
					{ name: "Voucher", amount: { amount: 25, currency: "CZK" } },
				],
			}),
		);
		expect(order.totals.discount_cents).toBe(7500);
	});

	it("breakdown is omitted when no per-line detail is available", () => {
		const order = mapOrderToProtocol(makeOrder());
		expect(order.totals.breakdown).toBeUndefined();
	});
});
