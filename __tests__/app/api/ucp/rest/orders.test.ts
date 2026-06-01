/**
 * Integration test for GET /api/ucp/rest/orders/[id].
 *
 * Asserts the order route runs through `withUcpRoute` (signed response, audit
 * log), handles not-found, and — critically — enforces object-level ownership
 * (IDOR/BOLA, CWE-639): only the owning OAuth customer may read an order, and a
 * non-owner / agent-only token gets 404. Auth is mocked at the
 * `verifyAgentRequest` boundary so we can drive the OAuth user context.
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

import { GET as readOrder } from "@/app/api/ucp/rest/orders/[id]/route";
import { _resetLimitBuckets } from "@/lib/protocols/shared/limits";

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

function fakeOrder(id = "ord_1", userEmail: string | null = "buyer@example.com") {
	return {
		id,
		number: "1001",
		status: "FULFILLED",
		created: "2026-05-01T10:00:00Z",
		userEmail,
		isPaid: true,
		channel: { slug: "default-channel" },
		total: {
			gross: { amount: 50, currency: "USD" },
			tax: { amount: 5, currency: "USD" },
		},
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

function authWithEmail(email: string | undefined) {
	return {
		ok: true,
		agent: agentWithScopes(["order.read"]),
		bodyText: "",
		isLegacy: email === undefined,
		...(email !== undefined
			? { userContext: { userId: "user_42", email, scope: "orders:read", saleorToken: "saleor_jwt" } }
			: {}),
	};
}

function getOrderRequest(id = "ord_1"): Request {
	return new Request(`https://store.example/api/ucp/rest/orders/${id}`, {
		method: "GET",
		headers: { Authorization: "Bearer eyJfaked" },
	});
}

describe("GET /api/ucp/rest/orders/[id] (integration)", () => {
	beforeEach(() => {
		mockSaleorQuery.mockReset();
		mockVerifyAgentRequest.mockReset();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		_resetLimitBuckets();
		vi.stubEnv("UCP_ENABLED", "true");
		vi.stubEnv("PAYLOAD_API_URL", "");
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		_resetLimitBuckets();
	});

	it("returns the order to its owning customer with a signed envelope", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce(authWithEmail("buyer@example.com"));
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { order: fakeOrder() } });

		const res = await readOrder(getOrderRequest(), { params: Promise.resolve({ id: "ord_1" }) });

		expect(res.status).toBe(200);
		expect(res.headers.get("UCP-Signature")).not.toBeNull();
		const body = (await res.json()) as { order: { id: string } };
		expect(body.order.id).toBe("ord_1");
	});

	it("returns 404 (not 403) when a DIFFERENT customer requests the order (IDOR)", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce(authWithEmail("attacker@evil.example"));
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { order: fakeOrder() } });

		const res = await readOrder(getOrderRequest(), { params: Promise.resolve({ id: "ord_1" }) });

		expect(res.status).toBe(404);
	});

	it("returns 404 for an agent-only token with no customer context", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce(authWithEmail(undefined));
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { order: fakeOrder() } });

		const res = await readOrder(getOrderRequest(), { params: Promise.resolve({ id: "ord_1" }) });

		expect(res.status).toBe(404);
	});

	it("returns 404 when the order is not found", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce(authWithEmail("buyer@example.com"));
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { order: null } });

		const res = await readOrder(getOrderRequest("missing"), {
			params: Promise.resolve({ id: "missing" }),
		});

		expect(res.status).toBe(404);
	});
});
