/**
 * Unit tests for the C1 return-mapper helpers: eligibility, refund estimation,
 * and the in-memory store roundtrip.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	_resetReturnsStore,
	checkReturnEligibility,
	createReturnRecord,
	estimateRefundCents,
	listReturnsForOrder,
	type OrderReturn,
} from "@/lib/protocols/shared/return-mapper";
import type { SaleorOrder } from "@/lib/protocols/shared/order-queries";

function makeOrder(overrides: Partial<SaleorOrder> = {}): SaleorOrder {
	return {
		id: "ord_1",
		number: "1001",
		status: "FULFILLED",
		created: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
		userEmail: "buyer@example.com",
		isPaid: true,
		channel: { slug: "default-channel" },
		total: {
			gross: { amount: 100, currency: "USD" },
			tax: { amount: 10, currency: "USD" },
		},
		subtotal: { gross: { amount: 90, currency: "USD" } },
		shippingPrice: { gross: { amount: 5, currency: "USD" } },
		shippingAddress: null,
		billingAddress: null,
		lines: [
			{
				id: "line_a",
				productName: "Widget",
				variantName: "Default",
				quantity: 2,
				unitPrice: { gross: { amount: 25, currency: "USD" } },
				totalPrice: { gross: { amount: 50, currency: "USD" } },
				thumbnail: null,
			},
			{
				id: "line_b",
				productName: "Gizmo",
				variantName: "Default",
				quantity: 1,
				unitPrice: { gross: { amount: 50, currency: "USD" } },
				totalPrice: { gross: { amount: 50, currency: "USD" } },
				thumbnail: null,
			},
		],
		deliveryMethod: null,
		discounts: [],
		statusDisplay: "Fulfilled",
		...overrides,
	};
}

describe("checkReturnEligibility", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("accepts a fresh, paid order with valid lines", () => {
		const order = makeOrder();
		const result = checkReturnEligibility(order, undefined, []);
		expect(result.ok).toBe(true);
	});

	it("rejects an unpaid order with not_paid", () => {
		const result = checkReturnEligibility(makeOrder({ isPaid: false }), undefined, []);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("not_paid");
	});

	it("rejects an order outside the configurable RETURN_WINDOW_DAYS", () => {
		const old = makeOrder({
			created: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
		});
		const result = checkReturnEligibility(old, undefined, []);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("window_expired");
	});

	it("honours RETURN_WINDOW_DAYS override", () => {
		vi.stubEnv("RETURN_WINDOW_DAYS", "90");
		const older = makeOrder({
			created: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
		});
		const result = checkReturnEligibility(older, undefined, []);
		expect(result.ok).toBe(true);
	});

	it("rejects unknown line IDs in partial returns", () => {
		const result = checkReturnEligibility(
			makeOrder(),
			[{ line_id: "line_zzz", quantity: 1 }],
			[],
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("unknown_line");
	});

	it("rejects when a prior return is already approved or refunded", () => {
		const result = checkReturnEligibility(makeOrder(), undefined, [
			{
				id: "ret_x",
				order_id: "ord_1",
				agent_id: "a",
				user_id: "u",
				reason: "defective",
				lines: [],
				refund_method: "original_payment",
				status: "approved",
				estimated_refund_cents: 0,
				currency: "USD",
				created_at: "",
				updated_at: "",
			} as OrderReturn,
		]);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("already_returned");
	});
});

describe("estimateRefundCents", () => {
	it("returns the full gross total when no specific lines are passed", () => {
		const out = estimateRefundCents(makeOrder(), undefined);
		expect(out.amount_cents).toBe(100_00);
		expect(out.currency).toBe("USD");
	});

	it("sums unitPrice × quantity for requested lines", () => {
		const out = estimateRefundCents(makeOrder(), [{ line_id: "line_a", quantity: 1 }]);
		// line_a unit price 25 USD × 1 = 25.00 → 2500¢
		expect(out.amount_cents).toBe(25_00);
	});

	it("skips unknown lines silently (eligibility already validated)", () => {
		const out = estimateRefundCents(makeOrder(), [{ line_id: "line_zzz", quantity: 99 }]);
		expect(out.amount_cents).toBe(0);
	});
});

describe("createReturnRecord + getReturnRecord + listReturnsForOrder", () => {
	beforeEach(() => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		_resetReturnsStore();
		vi.unstubAllEnvs();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		_resetReturnsStore();
	});

	it("persists a pending record with a return ID and surfaces it via list", async () => {
		const order = makeOrder();
		const record = await createReturnRecord(
			{
				order_id: order.id,
				agent_id: "agent_a",
				user_id: "user_b",
				reason: "defective",
				refund_method: "original_payment",
			},
			order,
		);

		expect(record.id).toMatch(/^ret_[0-9a-f]{32}$/);
		expect(record.status).toBe("pending");
		expect(record.estimated_refund_cents).toBe(100_00);
		expect(record.currency).toBe("USD");

		const list = listReturnsForOrder(order.id);
		expect(list).toHaveLength(1);
		expect(list[0]!.id).toBe(record.id);
	});
});
