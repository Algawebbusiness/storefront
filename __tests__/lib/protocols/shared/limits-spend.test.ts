import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkLimits, recordSpend, _resetLimitBuckets } from "@/lib/protocols/shared/limits";
import type { AgentIdentity } from "@/lib/protocols/shared/agent-registry-types";

function agent(overrides: Partial<AgentIdentity["spending_limit"]> = {}): AgentIdentity {
	return {
		id: "agent-spend",
		display_name: "spend",
		platform: "openai",
		status: "active",
		public_key: "",
		scope: ["checkout.complete"],
		spending_limit: { per_session_cents: null, per_day_cents: 10_000, per_month_cents: null, ...overrides },
		rate_limit: { requests_per_minute: 0, sessions_per_day: 0 },
		created_at: "2026-05-01T00:00:00Z",
		updated_at: "2026-05-01T00:00:00Z",
	};
}

describe("spending caps with recordSpend (durable counters)", () => {
	beforeEach(() => _resetLimitBuckets());
	afterEach(() => _resetLimitBuckets());

	it("allows spend under the day cap and blocks once recorded spend would exceed it", async () => {
		const a = agent({ per_day_cents: 10_000 });

		// 6000¢ request under the 10000¢ cap → allowed
		expect((await checkLimits(a, 6_000)).allowed).toBe(true);
		await recordSpend(a.id, 6_000);

		// another 6000¢ would push cumulative to 12000¢ > 10000¢ → blocked
		const blocked = await checkLimits(a, 6_000);
		expect(blocked.allowed).toBe(false);

		// a small 3000¢ request still fits (6000 + 3000 <= 10000) → allowed
		expect((await checkLimits(a, 3_000)).allowed).toBe(true);
	});

	it("per_session cap rejects a single over-cap request", async () => {
		const a = agent({ per_session_cents: 5_000, per_day_cents: null });
		expect((await checkLimits(a, 5_001)).allowed).toBe(false);
		expect((await checkLimits(a, 5_000)).allowed).toBe(true);
	});
});
