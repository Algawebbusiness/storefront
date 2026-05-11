/**
 * Integration test for POST /api/ucp/rest/payment-mandates (C9 skeleton).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentIdentity } from "@/lib/protocols/shared/agent-registry-types";

const mockVerifyAgentRequest = vi.fn();

vi.mock("@/lib/protocols/shared/auth", () => ({
	verifyAgentRequest: (...args: unknown[]) => mockVerifyAgentRequest(...args),
}));

import { POST as createMandateRoute } from "@/app/api/ucp/rest/payment-mandates/route";
import { _resetLimitBuckets } from "@/lib/protocols/shared/limits";
import { _resetMandates } from "@/lib/protocols/shared/payment-mandates";

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

function request(body: unknown): Request {
	return new Request("https://store.example/api/ucp/rest/payment-mandates", {
		method: "POST",
		headers: { Authorization: "Bearer eyJfaked" },
		body: JSON.stringify(body),
	});
}

describe("POST /api/ucp/rest/payment-mandates (integration)", () => {
	beforeEach(() => {
		mockVerifyAgentRequest.mockReset();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		_resetLimitBuckets();
		_resetMandates();
		vi.stubEnv("UCP_ENABLED", "true");
		vi.stubEnv("PAYLOAD_API_URL", "");
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		_resetLimitBuckets();
		_resetMandates();
	});

	it("returns 404 when MPP_ENABLED is unset", async () => {
		vi.stubEnv("MPP_ENABLED", "");
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes(["checkout.complete"]),
			bodyText: JSON.stringify({}),
			isLegacy: false,
		});

		const res = await createMandateRoute(
			request({
				max_per_period_cents: 1000,
				currency: "USD",
				period: "month",
				expires_at: new Date(Date.now() + 86400_000).toISOString(),
			}),
		);
		expect(res.status).toBe(404);
	});

	it("returns 201 with mandate_id when input is valid and MPP is enabled", async () => {
		vi.stubEnv("MPP_ENABLED", "true");
		const future = new Date(Date.now() + 86400_000).toISOString();
		const body = {
			max_per_period_cents: 5000,
			currency: "usd",
			period: "month",
			expires_at: future,
			description: "AI agent subscription",
		};
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes(["checkout.complete"]),
			bodyText: JSON.stringify(body),
			isLegacy: false,
		});

		const res = await createMandateRoute(request(body));
		expect(res.status).toBe(201);
		const out = (await res.json()) as {
			mandate_id: string;
			status: string;
			currency: string;
			period: string;
		};
		expect(out.mandate_id).toMatch(/^mnd_/);
		expect(out.status).toBe("active");
		expect(out.currency).toBe("USD");
		expect(out.period).toBe("month");
	});

	it("rejects expires_at in the past with 400", async () => {
		vi.stubEnv("MPP_ENABLED", "true");
		const past = new Date(Date.now() - 1).toISOString();
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes(["checkout.complete"]),
			bodyText: JSON.stringify({
				max_per_period_cents: 1000,
				currency: "USD",
				period: "month",
				expires_at: past,
			}),
			isLegacy: false,
		});

		const res = await createMandateRoute(
			request({
				max_per_period_cents: 1000,
				currency: "USD",
				period: "month",
				expires_at: past,
			}),
		);
		expect(res.status).toBe(400);
	});

	it("rejects when agent lacks checkout.complete scope", async () => {
		vi.stubEnv("MPP_ENABLED", "true");
		mockVerifyAgentRequest.mockResolvedValueOnce({
			ok: true,
			agent: agentWithScopes(["catalog.read"]),
			bodyText: JSON.stringify({}),
			isLegacy: false,
		});

		const res = await createMandateRoute(
			request({
				max_per_period_cents: 1000,
				currency: "USD",
				period: "month",
				expires_at: new Date(Date.now() + 86400_000).toISOString(),
			}),
		);
		expect(res.status).toBe(403);
	});
});
