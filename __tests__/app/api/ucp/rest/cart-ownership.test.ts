/**
 * Object-level ownership on cart/checkout routes (IDOR/BOLA, CWE-639):
 * unit-tests `ownsCheckout` plus an integration check that a non-owning agent
 * gets 404 from GET /carts/[id].
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentIdentity } from "@/lib/protocols/shared/agent-registry-types";
import { ownsCheckout } from "@/lib/protocols/shared/ownership";

function co(metadata: Array<{ key: string; value: string }>, email: string | null = null) {
	return { email, metadata };
}
function authFor(agentId: string, email?: string) {
	const agent = { id: agentId } as AgentIdentity;
	return email !== undefined ? { agent, userContext: { email } as never } : { agent };
}

describe("ownsCheckout", () => {
	it("true when the agent-binding metadata matches the agent id", () => {
		expect(ownsCheckout(co([{ key: "ucp.agent_id", value: "agent-a" }]), authFor("agent-a"))).toBe(true);
	});
	it("false when the binding is for a different agent", () => {
		expect(ownsCheckout(co([{ key: "ucp.agent_id", value: "agent-b" }]), authFor("agent-a"))).toBe(false);
	});
	it("true when an OAuth customer email matches the checkout email", () => {
		expect(ownsCheckout(co([], "buyer@example.com"), authFor("agent-a", "Buyer@Example.com"))).toBe(true);
	});
	it("false when there is neither a binding match nor an email match", () => {
		expect(ownsCheckout(co([]), authFor("agent-a"))).toBe(false);
	});
});

// ---- integration: GET /carts/[id] enforces ownership ----

const mockSaleorQuery = vi.fn();
vi.mock("@/mcp-server/saleor-client", () => ({
	saleorQuery: (...args: unknown[]) => mockSaleorQuery(...args),
	getDefaultChannel: () => "default-channel",
}));
const mockVerifyAgentRequest = vi.fn();
vi.mock("@/lib/protocols/shared/auth", () => ({
	verifyAgentRequest: (...args: unknown[]) => mockVerifyAgentRequest(...args),
}));

const { GET: getCart } = await import("@/app/api/ucp/rest/carts/[id]/route");
const { _resetLimitBuckets } = await import("@/lib/protocols/shared/limits");

function agent(id: string): AgentIdentity {
	return {
		id,
		display_name: id,
		platform: "openai",
		status: "active",
		public_key: "",
		scope: ["cart.create"],
		spending_limit: { per_session_cents: null, per_day_cents: null, per_month_cents: null },
		rate_limit: { requests_per_minute: 60, sessions_per_day: 1000 },
		created_at: "2026-05-01T00:00:00Z",
		updated_at: "2026-05-01T00:00:00Z",
	};
}

function fakeCheckout(bindingAgentId: string | null) {
	return {
		id: "co_1",
		email: null,
		channel: { id: "ch", slug: "default-channel" },
		lines: [],
		totalPrice: { gross: { amount: 0, currency: "USD" }, tax: { amount: 0, currency: "USD" } },
		subtotalPrice: { gross: { amount: 0, currency: "USD" } },
		shippingPrice: { gross: { amount: 0, currency: "USD" } },
		discount: null,
		shippingAddress: null,
		billingAddress: null,
		deliveryMethod: null,
		shippingMethods: [],
		isShippingRequired: false,
		authorizeStatus: "NONE",
		chargeStatus: "NONE",
		metadata: bindingAgentId ? [{ key: "ucp.agent_id", value: bindingAgentId }] : [],
	};
}

describe("GET /api/ucp/rest/carts/[id] ownership", () => {
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

	function req() {
		return new Request("https://store.example/api/ucp/rest/carts/co_1", {
			headers: { Authorization: "Bearer x" },
		});
	}

	it("returns the cart to the owning agent", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agent("agent-a"),
			bodyText: "",
			isLegacy: false,
		});
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { checkout: fakeCheckout("agent-a") } });
		const res = await getCart(req(), { params: Promise.resolve({ id: "co_1" }) });
		expect(res.status).toBe(200);
	});

	it("returns 404 to a different agent (IDOR)", async () => {
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agent("agent-a"),
			bodyText: "",
			isLegacy: false,
		});
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { checkout: fakeCheckout("agent-b") } });
		const res = await getCart(req(), { params: Promise.resolve({ id: "co_1" }) });
		expect(res.status).toBe(404);
	});
});
