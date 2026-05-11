/**
 * Integration tests for the C10 loyalty routes.
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

import { POST as applyLoyalty } from "@/app/api/ucp/rest/carts/[id]/loyalty/route";
import { DELETE as removeLoyalty } from "@/app/api/ucp/rest/carts/[id]/loyalty/[appliedId]/route";
import { _resetLimitBuckets } from "@/lib/protocols/shared/limits";

function agentWithScopes(scopes: AgentIdentity["scope"]): AgentIdentity {
	return {
		id: "agent_a",
		display_name: "Agent A",
		platform: "openai",
		status: "active",
		public_key: "",
		scope: scopes,
		spending_limit: { per_session_cents: null, per_day_cents: null, per_month_cents: null },
		rate_limit: { requests_per_minute: 60, sessions_per_day: 100 },
		created_at: "2026-05-01T00:00:00Z",
		updated_at: "2026-05-01T00:00:00Z",
	};
}

function fakeCheckout() {
	return {
		id: "cart_1",
		email: null,
		channel: { id: "ch", slug: "default-channel" },
		lines: [],
		totalPrice: {
			gross: { amount: 90, currency: "USD" },
			tax: { amount: 0, currency: "USD" },
		},
		subtotalPrice: { gross: { amount: 100, currency: "USD" } },
		shippingPrice: { gross: { amount: 0, currency: "USD" } },
		discount: { amount: 10, currency: "USD" },
		shippingAddress: null,
		billingAddress: null,
		deliveryMethod: null,
		shippingMethods: [],
		isShippingRequired: false,
		authorizeStatus: "NONE",
		chargeStatus: "NONE",
		metadata: [],
	};
}

describe("POST /api/ucp/rest/carts/:id/loyalty", () => {
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

	it("applies a code and surfaces the discounted cart", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes(["cart.update"]),
			bodyText: JSON.stringify({ code: "WELCOME10" }),
			isLegacy: false,
		});
		mockSaleorQuery.mockResolvedValueOnce({
			ok: true,
			data: { checkoutAddPromoCode: { checkout: fakeCheckout(), errors: [] } },
		});

		const res = await applyLoyalty(
			new Request("https://store.example/api/ucp/rest/carts/cart_1/loyalty", {
				method: "POST",
				headers: { Authorization: "Bearer dev-anything" },
				body: JSON.stringify({ code: "WELCOME10" }),
			}),
			{ params: Promise.resolve({ id: "cart_1" }) },
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { cart: { applied_discounts?: unknown[] }; applied: { code: string } };
		expect(body.applied.code).toBe("WELCOME10");
		expect(body.cart.applied_discounts).toHaveLength(1);
	});

	it("returns 400 with invalid_code when Saleor rejects the code as invalid", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes(["cart.update"]),
			bodyText: JSON.stringify({ code: "DOESNOTEXIST" }),
			isLegacy: false,
		});
		mockSaleorQuery.mockResolvedValueOnce({
			ok: true,
			data: {
				checkoutAddPromoCode: {
					checkout: null,
					errors: [{ field: "promoCode", message: "Promo code is not valid", code: "INVALID" }],
				},
			},
		});

		const res = await applyLoyalty(
			new Request("https://store.example/api/ucp/rest/carts/cart_1/loyalty", {
				method: "POST",
				headers: { Authorization: "Bearer dev-anything" },
				body: JSON.stringify({ code: "DOESNOTEXIST" }),
			}),
			{ params: Promise.resolve({ id: "cart_1" }) },
		);

		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("invalid_code");
	});

	it("returns 400 when body is missing the code", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes(["cart.update"]),
			bodyText: "{}",
			isLegacy: false,
		});

		const res = await applyLoyalty(
			new Request("https://store.example/api/ucp/rest/carts/cart_1/loyalty", {
				method: "POST",
				headers: { Authorization: "Bearer dev-anything" },
				body: "{}",
			}),
			{ params: Promise.resolve({ id: "cart_1" }) },
		);

		expect(res.status).toBe(400);
		expect(mockSaleorQuery).not.toHaveBeenCalled();
	});
});

describe("DELETE /api/ucp/rest/carts/:id/loyalty/:appliedId", () => {
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

	it("removes the code and returns the recomputed cart", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes(["cart.update"]),
			bodyText: "",
			isLegacy: false,
		});
		mockSaleorQuery.mockResolvedValueOnce({
			ok: true,
			data: {
				checkoutRemovePromoCode: { checkout: { ...fakeCheckout(), discount: null }, errors: [] },
			},
		});

		const res = await removeLoyalty(
			new Request("https://store.example/api/ucp/rest/carts/cart_1/loyalty/WELCOME10", {
				method: "DELETE",
				headers: { Authorization: "Bearer dev-anything" },
			}),
			{ params: Promise.resolve({ id: "cart_1", appliedId: "WELCOME10" }) },
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { removed: { code: string } };
		expect(body.removed.code).toBe("WELCOME10");
	});
});
