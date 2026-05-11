/**
 * Integration test for GET /api/ucp/rest/orders/[id]/return/[returnId] (C2).
 *
 * Uses the shared in-memory returns store + mocked verifyAgentRequest so we
 * can craft scope + ownership scenarios.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentIdentity } from "@/lib/protocols/shared/agent-registry-types";

const mockVerifyAgentRequest = vi.fn();

vi.mock("@/lib/protocols/shared/auth", () => ({
	verifyAgentRequest: (...args: unknown[]) => mockVerifyAgentRequest(...args),
}));

import { GET as pollReturn } from "@/app/api/ucp/rest/orders/[id]/return/[returnId]/route";
import { _resetLimitBuckets } from "@/lib/protocols/shared/limits";
import {
	_resetReturnsStore,
	createReturnRecord,
} from "@/lib/protocols/shared/return-mapper";
import type { SaleorOrder } from "@/lib/protocols/shared/order-queries";

function agentWithScopes(id: string, scopes: AgentIdentity["scope"]): AgentIdentity {
	return {
		id,
		display_name: id,
		platform: "openai",
		status: "active",
		public_key: "",
		scope: scopes,
		spending_limit: { per_session_cents: null, per_day_cents: null, per_month_cents: null },
		rate_limit: { requests_per_minute: 60, sessions_per_day: 1000 },
		created_at: "2026-05-01T00:00:00Z",
		updated_at: "2026-05-01T00:00:00Z",
	};
}

function makeOrder(): SaleorOrder {
	return {
		id: "ord_1",
		number: "1001",
		status: "FULFILLED",
		created: new Date().toISOString(),
		userEmail: "b@x.cz",
		isPaid: true,
		channel: { slug: "default-channel" },
		total: { gross: { amount: 30, currency: "USD" }, tax: { amount: 3, currency: "USD" } },
		subtotal: { gross: { amount: 27, currency: "USD" } },
		shippingPrice: { gross: { amount: 0, currency: "USD" } },
		shippingAddress: null,
		billingAddress: null,
		lines: [
			{
				id: "line_a",
				productName: "Widget",
				variantName: "Default",
				quantity: 1,
				unitPrice: { gross: { amount: 30, currency: "USD" } },
				totalPrice: { gross: { amount: 30, currency: "USD" } },
				thumbnail: null,
			},
		],
		deliveryMethod: null,
		discounts: [],
		statusDisplay: "Fulfilled",
	};
}

function pollRequest(): Request {
	return new Request("https://store.example/api/ucp/rest/orders/ord_1/return/ret_x", {
		method: "GET",
		headers: { Authorization: "Bearer eyJfaked" },
	});
}

describe("GET /api/ucp/rest/orders/[id]/return/[returnId] (integration)", () => {
	beforeEach(() => {
		mockVerifyAgentRequest.mockReset();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		_resetLimitBuckets();
		_resetReturnsStore();
		vi.stubEnv("UCP_ENABLED", "true");
		vi.stubEnv("PAYLOAD_API_URL", "");
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		_resetLimitBuckets();
		_resetReturnsStore();
	});

	it("returns the return record when scope + ownership match", async () => {
		const rec = await createReturnRecord(
			{
				order_id: "ord_1",
				agent_id: "agent_a",
				user_id: "user_x",
				reason: "defective",
				refund_method: "original_payment",
			},
			makeOrder(),
		);

		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes("agent_a", ["order.return"]),
			bodyText: "",
			isLegacy: false,
		});

		const res = await pollReturn(pollRequest(), {
			params: Promise.resolve({ id: "ord_1", returnId: rec.id }),
		});

		expect(res.status).toBe(200);
		const body = (await res.json()) as { return: { id: string; status: string } };
		expect(body.return.id).toBe(rec.id);
		expect(body.return.status).toBe("pending");
	});

	it("rejects with 403 when a different agent tries to poll the return", async () => {
		const rec = await createReturnRecord(
			{
				order_id: "ord_1",
				agent_id: "agent_a",
				user_id: "user_x",
				reason: "defective",
				refund_method: "original_payment",
			},
			makeOrder(),
		);

		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes("agent_b", ["order.return"]),
			bodyText: "",
			isLegacy: false,
		});

		const res = await pollReturn(pollRequest(), {
			params: Promise.resolve({ id: "ord_1", returnId: rec.id }),
		});

		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("forbidden");
	});

	it("returns 404 when the return id is not found on the order", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes("agent_a", ["order.return"]),
			bodyText: "",
			isLegacy: false,
		});

		const res = await pollReturn(pollRequest(), {
			params: Promise.resolve({ id: "ord_1", returnId: "ret_missing" }),
		});

		expect(res.status).toBe(404);
	});
});
