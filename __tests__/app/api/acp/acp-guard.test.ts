/**
 * ACP routes now run through `withAcpRoute` (scope + limits + activity log)
 * instead of the deprecated `validateAgentApiKey` which bypassed all guards.
 * These tests verify scope enforcement on checkout completion and object-level
 * ownership on order reads (IDOR/BOLA). Auth + Saleor are mocked.
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

import { POST as completeAcp } from "@/app/api/acp/checkout/[id]/complete/route";
import { GET as getAcpOrder } from "@/app/api/acp/orders/[id]/route";
import { _resetLimitBuckets } from "@/lib/protocols/shared/limits";

function agent(scopes: AgentIdentity["scope"]): AgentIdentity {
	return {
		id: "acp-test",
		display_name: "ACP test",
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

function auth(scopes: AgentIdentity["scope"], email?: string) {
	return {
		ok: true,
		agent: agent(scopes),
		bodyText: JSON.stringify({ payment_token: "tok_x" }),
		isLegacy: email === undefined,
		...(email !== undefined ? { userContext: { userId: "u1", email, scope: "x", saleorToken: "t" } } : {}),
	};
}

function fakeOrder(userEmail: string | null = "buyer@example.com") {
	return {
		id: "ord_1",
		number: "1001",
		status: "FULFILLED",
		created: "2026-05-01T10:00:00Z",
		userEmail,
		isPaid: true,
		channel: { slug: "default-channel" },
		total: { gross: { amount: 50, currency: "USD" }, tax: { amount: 5, currency: "USD" } },
		subtotal: { gross: { amount: 45, currency: "USD" } },
		shippingPrice: { gross: { amount: 5, currency: "USD" } },
		shippingAddress: null,
		billingAddress: null,
		lines: [],
		deliveryMethod: null,
		discounts: [],
		statusDisplay: "Fulfilled",
	};
}

describe("ACP routes via withAcpRoute", () => {
	beforeEach(() => {
		mockSaleorQuery.mockReset();
		mockVerifyAgentRequest.mockReset();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		_resetLimitBuckets();
		vi.stubEnv("ACP_ENABLED", "true");
		vi.stubEnv("PAYLOAD_API_URL", "");
	});
	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		_resetLimitBuckets();
	});

	function req(body: unknown = { payment_token: "tok_x" }): Request {
		return new Request("https://store.example/api/acp/checkout/ord_1/complete", {
			method: "POST",
			headers: { Authorization: "Bearer x", "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	it("returns 404 when ACP is disabled", async () => {
		vi.stubEnv("ACP_ENABLED", "false");
		const res = await completeAcp(req(), { params: Promise.resolve({ id: "ord_1" }) });
		expect(res.status).toBe(404);
		expect(mockVerifyAgentRequest).not.toHaveBeenCalled();
	});

	it("complete: 403 when the agent lacks checkout.complete scope", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce(auth(["catalog.read"]));
		const res = await completeAcp(req(), { params: Promise.resolve({ id: "ord_1" }) });
		expect(res.status).toBe(403);
		expect(mockSaleorQuery).not.toHaveBeenCalled();
	});

	it("order read: returns the order to its owning customer", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce(auth(["order.read"], "buyer@example.com"));
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { order: fakeOrder() } });
		const res = await getAcpOrder(
			new Request("https://store.example/api/acp/orders/ord_1", {
				headers: { Authorization: "Bearer x" },
			}),
			{ params: Promise.resolve({ id: "ord_1" }) },
		);
		expect(res.status).toBe(200);
	});

	it("order read: 404 for a DIFFERENT customer (IDOR)", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce(auth(["order.read"], "attacker@evil.example"));
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { order: fakeOrder() } });
		const res = await getAcpOrder(
			new Request("https://store.example/api/acp/orders/ord_1", {
				headers: { Authorization: "Bearer x" },
			}),
			{ params: Promise.resolve({ id: "ord_1" }) },
		);
		expect(res.status).toBe(404);
	});

	it("order read: 404 for an agent-only token (no customer context)", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce(auth(["order.read"]));
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { order: fakeOrder() } });
		const res = await getAcpOrder(
			new Request("https://store.example/api/acp/orders/ord_1", {
				headers: { Authorization: "Bearer x" },
			}),
			{ params: Promise.resolve({ id: "ord_1" }) },
		);
		expect(res.status).toBe(404);
	});
});
