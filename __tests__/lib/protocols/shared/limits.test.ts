import { afterEach, describe, expect, it, vi } from "vitest";
import { checkLimits, _resetLimitBuckets } from "@/lib/protocols/shared/limits";
import type { AgentIdentity } from "@/lib/protocols/shared/agent-registry-types";

function makeAgent(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
	return {
		id: "test-agent",
		display_name: "Test agent",
		platform: "openai",
		status: "active",
		public_key: "",
		scope: ["catalog.read", "checkout.complete"],
		spending_limit: { per_session_cents: null, per_day_cents: null, per_month_cents: null },
		rate_limit: { requests_per_minute: 5, sessions_per_day: 10 },
		created_at: "2026-05-01T00:00:00Z",
		updated_at: "2026-05-01T00:00:00Z",
		...overrides,
	};
}

describe("checkLimits — requests_per_minute", () => {
	afterEach(() => {
		_resetLimitBuckets();
		vi.unstubAllEnvs();
	});

	it("allows requests up to the cap, blocks the next one with Retry-After", async () => {
		const agent = makeAgent({
			rate_limit: { requests_per_minute: 3, sessions_per_day: 1000 },
		});
		expect((await checkLimits(agent)).allowed).toBe(true);
		expect((await checkLimits(agent)).allowed).toBe(true);
		expect((await checkLimits(agent)).allowed).toBe(true);
		const blocked = await checkLimits(agent);
		expect(blocked.allowed).toBe(false);
		if (!blocked.allowed) {
			expect(blocked.reason).toMatch(/Rate limit/);
			expect(blocked.retry_after_s).toBeGreaterThanOrEqual(1);
			expect(blocked.retry_after_s).toBeLessThanOrEqual(60);
		}
	});

	it("isolates buckets per agent_id", async () => {
		const a = makeAgent({ id: "a", rate_limit: { requests_per_minute: 1, sessions_per_day: 100 } });
		const b = makeAgent({ id: "b", rate_limit: { requests_per_minute: 1, sessions_per_day: 100 } });
		expect((await checkLimits(a)).allowed).toBe(true);
		expect((await checkLimits(b)).allowed).toBe(true);
		// `a` is now over but `b` still has room
		expect((await checkLimits(a)).allowed).toBe(false);
		expect((await checkLimits(b)).allowed).toBe(false);
	});

	it("treats requests_per_minute=0 as unlimited (escape hatch)", async () => {
		const agent = makeAgent({
			rate_limit: { requests_per_minute: 0, sessions_per_day: 1000 },
		});
		for (let i = 0; i < 100; i++) {
			expect((await checkLimits(agent)).allowed).toBe(true);
		}
	});
});

describe("checkLimits — sessions_per_day", () => {
	afterEach(() => {
		_resetLimitBuckets();
	});

	it("counts unique session IDs and blocks beyond cap", async () => {
		const agent = makeAgent({
			rate_limit: { requests_per_minute: 1000, sessions_per_day: 2 },
		});
		expect((await checkLimits(agent, null, "sess-A")).allowed).toBe(true);
		expect((await checkLimits(agent, null, "sess-B")).allowed).toBe(true);
		// Same session as before — does not count again
		expect((await checkLimits(agent, null, "sess-A")).allowed).toBe(true);
		// New session — over cap
		const blocked = await checkLimits(agent, null, "sess-C");
		expect(blocked.allowed).toBe(false);
		if (!blocked.allowed) expect(blocked.reason).toMatch(/Sessions\/day/);
	});

	it("ignores session counting when no session_id passed", async () => {
		const agent = makeAgent({
			rate_limit: { requests_per_minute: 1000, sessions_per_day: 1 },
		});
		expect((await checkLimits(agent)).allowed).toBe(true);
		expect((await checkLimits(agent)).allowed).toBe(true);
	});
});

describe("checkLimits — spending caps (per-session)", () => {
	afterEach(() => {
		_resetLimitBuckets();
		vi.unstubAllEnvs();
	});

	it("blocks when requested amount exceeds per_session_cents", async () => {
		const agent = makeAgent({
			spending_limit: { per_session_cents: 50_000, per_day_cents: null, per_month_cents: null },
			rate_limit: { requests_per_minute: 100, sessions_per_day: 1000 },
		});
		const result = await checkLimits(agent, 60_000);
		expect(result.allowed).toBe(false);
		if (!result.allowed) expect(result.reason).toMatch(/per-session cap/);
	});

	it("allows at exactly the cap", async () => {
		const agent = makeAgent({
			spending_limit: { per_session_cents: 50_000, per_day_cents: null, per_month_cents: null },
			rate_limit: { requests_per_minute: 100, sessions_per_day: 1000 },
		});
		expect((await checkLimits(agent, 50_000)).allowed).toBe(true);
	});

	it("ignores spending check when amount is null/undefined/0", async () => {
		const agent = makeAgent({
			spending_limit: { per_session_cents: 1, per_day_cents: 1, per_month_cents: 1 },
			rate_limit: { requests_per_minute: 100, sessions_per_day: 1000 },
		});
		expect((await checkLimits(agent)).allowed).toBe(true);
		expect((await checkLimits(agent, null)).allowed).toBe(true);
		expect((await checkLimits(agent, 0)).allowed).toBe(true);
	});

	it("ignores per-session cap when null (unlimited)", async () => {
		const agent = makeAgent({
			spending_limit: { per_session_cents: null, per_day_cents: null, per_month_cents: null },
			rate_limit: { requests_per_minute: 100, sessions_per_day: 1000 },
		});
		expect((await checkLimits(agent, 1_000_000_000)).allowed).toBe(true);
	});
});

describe("checkLimits — daily/monthly without Payload (graceful skip)", () => {
	afterEach(() => {
		_resetLimitBuckets();
		vi.unstubAllEnvs();
	});

	it("allows large requests against day cap when Payload is not configured (best-effort)", async () => {
		vi.stubEnv("PAYLOAD_API_URL", "");
		const agent = makeAgent({
			spending_limit: { per_session_cents: null, per_day_cents: 1_000_00, per_month_cents: null },
			rate_limit: { requests_per_minute: 100, sessions_per_day: 1000 },
		});
		// Without Payload, prior-spent reads as 0 → only this request is checked.
		// Within cap.
		expect((await checkLimits(agent, 50_000)).allowed).toBe(true);
		// Single request exceeds cap → blocked.
		const blocked = await checkLimits(agent, 200_000);
		expect(blocked.allowed).toBe(false);
		if (!blocked.allowed) expect(blocked.reason).toMatch(/Day spending/);
	});
});

describe("checkLimits — agents are independent", () => {
	afterEach(() => _resetLimitBuckets());

	it("one agent's spending doesn't leak into another's session bucket", async () => {
		const big = makeAgent({
			id: "big",
			spending_limit: { per_session_cents: 100_000, per_day_cents: null, per_month_cents: null },
			rate_limit: { requests_per_minute: 1000, sessions_per_day: 1000 },
		});
		const small = makeAgent({
			id: "small",
			spending_limit: { per_session_cents: 1_000, per_day_cents: null, per_month_cents: null },
			rate_limit: { requests_per_minute: 1000, sessions_per_day: 1000 },
		});
		expect((await checkLimits(big, 90_000)).allowed).toBe(true);
		expect((await checkLimits(small, 2_000)).allowed).toBe(false);
		expect((await checkLimits(small, 500)).allowed).toBe(true);
	});
});
