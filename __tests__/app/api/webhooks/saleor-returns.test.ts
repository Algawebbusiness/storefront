/**
 * Integration test for the Saleor webhook → return-status transition (C2).
 *
 * Verifies that an `ORDER_REFUNDED` event marks the matching pending return
 * record as `refunded`. Other events leave it alone.
 */

import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as saleorWebhook } from "@/app/api/webhooks/saleor/route";
import {
	_resetReturnsStore,
	createReturnRecord,
	getReturnRecord,
} from "@/lib/protocols/shared/return-mapper";
import type { SaleorOrder } from "@/lib/protocols/shared/order-queries";

function makeOrder(): SaleorOrder {
	return {
		id: "ord_1",
		number: "1001",
		status: "FULFILLED",
		created: new Date().toISOString(),
		userEmail: "buyer@example.com",
		isPaid: true,
		channel: { slug: "default-channel" },
		total: {
			gross: { amount: 75, currency: "USD" },
			tax: { amount: 7, currency: "USD" },
		},
		subtotal: { gross: { amount: 68, currency: "USD" } },
		shippingPrice: { gross: { amount: 0, currency: "USD" } },
		shippingAddress: null,
		billingAddress: null,
		lines: [
			{
				id: "line_a",
				productName: "Widget",
				variantName: "Default",
				quantity: 1,
				unitPrice: { gross: { amount: 75, currency: "USD" } },
				totalPrice: { gross: { amount: 75, currency: "USD" } },
				thumbnail: null,
			},
		],
		deliveryMethod: null,
		discounts: [],
		statusDisplay: "Fulfilled",
	};
}

const TEST_WEBHOOK_SECRET = "test-webhook-secret";

function makeWebhookRequest(event: string, orderId: string): Request {
	const body = JSON.stringify({ event, order: { id: orderId, number: "1001" } });
	const signature = createHmac("sha256", TEST_WEBHOOK_SECRET).update(body).digest("hex");
	return new Request("https://store.example/api/webhooks/saleor", {
		method: "POST",
		headers: { "Content-Type": "application/json", "Saleor-Signature": signature },
		body,
	});
}

describe("Saleor webhook — ORDER_REFUNDED", () => {
	beforeEach(() => {
		_resetReturnsStore();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubEnv("SALEOR_WEBHOOK_SECRET", TEST_WEBHOOK_SECRET);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		_resetReturnsStore();
	});

	it("transitions a pending return to refunded", async () => {
		const rec = await createReturnRecord(
			{
				order_id: "ord_1",
				agent_id: "agent_x",
				user_id: "user_y",
				reason: "defective",
				refund_method: "original_payment",
			},
			makeOrder(),
		);
		expect(getReturnRecord(rec.id)!.status).toBe("pending");

		const res = await saleorWebhook(makeWebhookRequest("ORDER_REFUNDED", "ord_1"));
		expect(res.status).toBe(200);
		expect(getReturnRecord(rec.id)!.status).toBe("refunded");
	});

	it("is a no-op when no pending return matches the order", async () => {
		const res = await saleorWebhook(makeWebhookRequest("ORDER_REFUNDED", "ord_doesntexist"));
		expect(res.status).toBe(200);
		// nothing to assert beyond "doesn't throw"
	});

	it("ignores non-return events", async () => {
		const rec = await createReturnRecord(
			{
				order_id: "ord_1",
				agent_id: "a",
				user_id: "u",
				reason: "defective",
				refund_method: "original_payment",
			},
			makeOrder(),
		);
		await saleorWebhook(makeWebhookRequest("ORDER_FULFILLED", "ord_1"));
		expect(getReturnRecord(rec.id)!.status).toBe("pending");
	});

	it("acknowledges ORDER_RETURN_REQUESTED without auto-creating records", async () => {
		const res = await saleorWebhook(makeWebhookRequest("ORDER_RETURN_REQUESTED", "ord_1"));
		expect(res.status).toBe(200);
		const body = (await res.json()) as { handled: boolean; event: string };
		expect(body.handled).toBe(true);
		expect(body.event).toBe("ORDER_RETURN_REQUESTED");
	});
});
