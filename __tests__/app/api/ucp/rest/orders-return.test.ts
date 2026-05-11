/**
 * Integration tests for POST /api/ucp/rest/orders/[id]/return (Phase C1).
 *
 * Auth is mocked at the `verifyAgentRequest` boundary so we can drive both
 * the agent identity (scope) and the OAuth user context independently. Saleor
 * is mocked at `saleorQuery`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentIdentity } from "@/lib/protocols/shared/agent-registry-types";

const mockSaleorQuery = vi.fn();

vi.mock("@/mcp-server/saleor-client", () => ({
	saleorQuery: (...args: unknown[]) => mockSaleorQuery(...args),
	getDefaultChannel: () => "default-channel",
}));

const mockVerifyAgentRequest = vi.fn();

vi.mock("@/lib/protocols/shared/auth", () => ({
	verifyAgentRequest: (...args: unknown[]) => mockVerifyAgentRequest(...args),
}));

import { POST as createReturn } from "@/app/api/ucp/rest/orders/[id]/return/route";
import { _resetLimitBuckets } from "@/lib/protocols/shared/limits";
import { _resetReturnsStore } from "@/lib/protocols/shared/return-mapper";

function agentWithScopes(scopes: AgentIdentity["scope"]): AgentIdentity {
	return {
		id: "openai-test",
		display_name: "OpenAI test",
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

function fakeOrder(opts: { paid?: boolean; daysAgo?: number } = {}) {
	return {
		id: "ord_1",
		number: "1001",
		status: "FULFILLED",
		created: new Date(Date.now() - (opts.daysAgo ?? 3) * 24 * 60 * 60 * 1000).toISOString(),
		userEmail: "buyer@example.com",
		isPaid: opts.paid ?? true,
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
				quantity: 1,
				unitPrice: { gross: { amount: 100, currency: "USD" } },
				totalPrice: { gross: { amount: 100, currency: "USD" } },
				thumbnail: null,
			},
		],
		deliveryMethod: null,
		discounts: [],
		statusDisplay: "Fulfilled",
	};
}

function setupEnv() {
	vi.stubEnv("UCP_ENABLED", "true");
	vi.stubEnv("PAYLOAD_API_URL", "");
}

function requestWithBody(body: unknown): Request {
	return new Request("https://store.example/api/ucp/rest/orders/ord_1/return", {
		method: "POST",
		headers: { Authorization: "Bearer eyJfaked", "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("POST /api/ucp/rest/orders/[id]/return (integration)", () => {
	beforeEach(() => {
		mockSaleorQuery.mockReset();
		mockVerifyAgentRequest.mockReset();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		_resetLimitBuckets();
		_resetReturnsStore();
		setupEnv();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		_resetLimitBuckets();
		_resetReturnsStore();
	});

	it("rejects with 403 when the agent lacks order.return scope (legacy bearer)", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes(["catalog.read"]),
			bodyText: "{}",
			isLegacy: true,
		});

		const res = await createReturn(
			requestWithBody({ reason: "defective", refund_method: "original_payment" }),
			{ params: Promise.resolve({ id: "ord_1" }) },
		);

		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe("forbidden");
		expect(mockSaleorQuery).not.toHaveBeenCalled();
	});

	it("rejects with 403 when scope is present but OAuth user context is missing", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes(["order.return"]),
			bodyText: JSON.stringify({ reason: "defective", refund_method: "original_payment" }),
			isLegacy: false,
		});

		const res = await createReturn(
			requestWithBody({ reason: "defective", refund_method: "original_payment" }),
			{ params: Promise.resolve({ id: "ord_1" }) },
		);

		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("oauth_required");
		expect(mockSaleorQuery).not.toHaveBeenCalled();
	});

	it("returns 200 with a pending return record when scope + OAuth + paid order line up", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes(["order.return"]),
			bodyText: JSON.stringify({ reason: "defective", refund_method: "original_payment" }),
			isLegacy: false,
			userContext: {
				userId: "user_42",
				email: "buyer@example.com",
				scope: "orders:return",
				saleorToken: "saleor_jwt",
			},
		});
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { order: fakeOrder() } });

		const res = await createReturn(
			requestWithBody({ reason: "defective", refund_method: "original_payment" }),
			{ params: Promise.resolve({ id: "ord_1" }) },
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			return_id: string;
			status: string;
			estimated_refund_cents: number;
			currency: string;
		};
		expect(body.return_id).toMatch(/^ret_/);
		expect(body.status).toBe("pending");
		expect(body.estimated_refund_cents).toBe(100_00);
		expect(body.currency).toBe("USD");
	});

	it("returns 409 with window_expired when the order is older than RETURN_WINDOW_DAYS", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes(["order.return"]),
			bodyText: JSON.stringify({ reason: "defective", refund_method: "original_payment" }),
			isLegacy: false,
			userContext: {
				userId: "user_42",
				email: "buyer@example.com",
				scope: "orders:return",
				saleorToken: "saleor_jwt",
			},
		});
		mockSaleorQuery.mockResolvedValueOnce({
			ok: true,
			data: { order: fakeOrder({ daysAgo: 60 }) },
		});

		const res = await createReturn(
			requestWithBody({ reason: "defective", refund_method: "original_payment" }),
			{ params: Promise.resolve({ id: "ord_1" }) },
		);

		expect(res.status).toBe(409);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("window_expired");
	});

	it("returns 400 for invalid reason", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes(["order.return"]),
			bodyText: JSON.stringify({ reason: "not_a_reason", refund_method: "original_payment" }),
			isLegacy: false,
			userContext: {
				userId: "user_42",
				email: "buyer@example.com",
				scope: "orders:return",
				saleorToken: "saleor_jwt",
			},
		});

		const res = await createReturn(
			requestWithBody({ reason: "not_a_reason", refund_method: "original_payment" }),
			{ params: Promise.resolve({ id: "ord_1" }) },
		);

		expect(res.status).toBe(400);
		expect(mockSaleorQuery).not.toHaveBeenCalled();
	});
});
