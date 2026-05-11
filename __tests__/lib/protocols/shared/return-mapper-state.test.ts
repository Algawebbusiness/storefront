/**
 * Status-transition tests for the C2 surface on return-mapper:
 * updateReturnStatus + findPendingReturnForOrder.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	_resetReturnsStore,
	createReturnRecord,
	findPendingReturnForOrder,
	getReturnRecord,
	updateReturnStatus,
} from "@/lib/protocols/shared/return-mapper";
import type { SaleorOrder } from "@/lib/protocols/shared/order-queries";

function makeOrder(): SaleorOrder {
	return {
		id: "ord_1",
		number: "1001",
		status: "FULFILLED",
		created: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
		userEmail: "buyer@example.com",
		isPaid: true,
		channel: { slug: "default-channel" },
		total: {
			gross: { amount: 50, currency: "USD" },
			tax: { amount: 5, currency: "USD" },
		},
		subtotal: { gross: { amount: 45, currency: "USD" } },
		shippingPrice: { gross: { amount: 0, currency: "USD" } },
		shippingAddress: null,
		billingAddress: null,
		lines: [
			{
				id: "line_a",
				productName: "Widget",
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
	};
}

describe("updateReturnStatus + findPendingReturnForOrder", () => {
	beforeEach(() => {
		_resetReturnsStore();
		vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	it("updates status and bumps updated_at", async () => {
		const rec = await createReturnRecord(
			{
				order_id: "ord_1",
				agent_id: "agent",
				user_id: "user",
				reason: "defective",
				refund_method: "original_payment",
			},
			makeOrder(),
		);
		const before = rec.updated_at;
		// Tiny delay so updated_at strictly advances (1ms resolution is OK).
		await new Promise((r) => setTimeout(r, 5));

		const updated = updateReturnStatus(rec.id, "approved");
		expect(updated).toBeDefined();
		expect(updated!.status).toBe("approved");
		expect(updated!.updated_at >= before).toBe(true);

		expect(getReturnRecord(rec.id)!.status).toBe("approved");
	});

	it("returns undefined when updating an unknown return id", () => {
		expect(updateReturnStatus("ret_doesnotexist", "approved")).toBeUndefined();
	});

	it("findPendingReturnForOrder returns the most recent pending record", async () => {
		const order = makeOrder();
		const first = await createReturnRecord(
			{
				order_id: order.id,
				agent_id: "a",
				user_id: "u",
				reason: "defective",
				refund_method: "original_payment",
			},
			order,
		);
		await new Promise((r) => setTimeout(r, 5));
		const second = await createReturnRecord(
			{
				order_id: order.id,
				agent_id: "a",
				user_id: "u",
				reason: "wrong_item",
				refund_method: "store_credit",
			},
			order,
		);

		const pending = findPendingReturnForOrder(order.id);
		expect(pending?.id).toBe(second.id);

		// Once `second` is settled, the older `first` becomes the next match.
		updateReturnStatus(second.id, "refunded");
		expect(findPendingReturnForOrder(order.id)?.id).toBe(first.id);
	});

	it("ignores non-pending returns for the order", async () => {
		const order = makeOrder();
		const rec = await createReturnRecord(
			{
				order_id: order.id,
				agent_id: "a",
				user_id: "u",
				reason: "defective",
				refund_method: "original_payment",
			},
			order,
		);
		updateReturnStatus(rec.id, "rejected");
		expect(findPendingReturnForOrder(order.id)).toBeUndefined();
	});
});
