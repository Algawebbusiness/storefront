import { afterEach, describe, expect, it, vi } from "vitest";
import { detectAbuse } from "@/lib/protocols/shared/abuse-detection";
import type { AgentActivityEntry } from "@/lib/protocols/shared/agent-log";

function entry(overrides: Partial<AgentActivityEntry> = {}): AgentActivityEntry {
	return {
		agent_id: "a",
		action: "cart.create",
		status: "success",
		status_code: 201,
		duration_ms: 10,
		created_at: new Date().toISOString(),
		...overrides,
	};
}

describe("detectAbuse — rate spike", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("flags an agent with > baseline*mult requests in the last minute", () => {
		vi.stubEnv("ABUSE_BASELINE_RPM", "1");
		vi.stubEnv("ABUSE_RATE_SPIKE_MULT", "2"); // threshold = 2 → flag at 3+
		const entries = Array.from({ length: 5 }, () => entry({ agent_id: "noisy" }));
		const flags = detectAbuse({ entries });
		expect(flags.some((f) => f.agent_id === "noisy" && f.rule === "rate_spike")).toBe(true);
	});

	it("does not flag at the threshold", () => {
		vi.stubEnv("ABUSE_BASELINE_RPM", "1");
		vi.stubEnv("ABUSE_RATE_SPIKE_MULT", "5");
		const entries = Array.from({ length: 5 }, () => entry({ agent_id: "borderline" }));
		const flags = detectAbuse({ entries });
		expect(flags.some((f) => f.agent_id === "borderline" && f.rule === "rate_spike")).toBe(false);
	});

	it("ignores entries older than 60s", () => {
		vi.stubEnv("ABUSE_BASELINE_RPM", "1");
		vi.stubEnv("ABUSE_RATE_SPIKE_MULT", "2");
		const old = new Date(Date.now() - 5 * 60 * 1000).toISOString();
		const entries = Array.from({ length: 100 }, () => entry({ agent_id: "stale", created_at: old }));
		const flags = detectAbuse({ entries });
		expect(flags.some((f) => f.agent_id === "stale" && f.rule === "rate_spike")).toBe(false);
	});
});

describe("detectAbuse — duplicate sessions / shared resources", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("flags every agent that touched a resource shared by N+ agents", () => {
		vi.stubEnv("ABUSE_DUPLICATE_SESSION_AGENTS", "3");
		const sharedCart = "ck_shared";
		const entries = [
			entry({ agent_id: "agent-1", resource_id: sharedCart }),
			entry({ agent_id: "agent-2", resource_id: sharedCart }),
			entry({ agent_id: "agent-3", resource_id: sharedCart }),
		];
		const flags = detectAbuse({ entries });
		const flagged = flags.filter((f) => f.rule === "duplicate_session").map((f) => f.agent_id);
		expect(flagged.sort()).toEqual(["agent-1", "agent-2", "agent-3"]);
	});

	it("does not flag below the threshold", () => {
		vi.stubEnv("ABUSE_DUPLICATE_SESSION_AGENTS", "5");
		const entries = [
			entry({ agent_id: "a1", resource_id: "ck_x" }),
			entry({ agent_id: "a2", resource_id: "ck_x" }),
		];
		const flags = detectAbuse({ entries });
		expect(flags.some((f) => f.rule === "duplicate_session")).toBe(false);
	});
});

describe("detectAbuse — failed payment ratio", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("flags when failed/attempts > threshold and attempts >= min", () => {
		vi.stubEnv("ABUSE_FAILED_PAYMENT_RATIO", "0.5");
		vi.stubEnv("ABUSE_FAILED_PAYMENT_MIN", "4");
		const entries = [
			entry({ agent_id: "shaky", action: "checkout.complete", status: "success", status_code: 200 }),
			entry({ agent_id: "shaky", action: "checkout.complete", status: "error", status_code: 500 }),
			entry({ agent_id: "shaky", action: "checkout.complete", status: "error", status_code: 500 }),
			entry({ agent_id: "shaky", action: "checkout.complete", status: "error", status_code: 500 }),
		];
		const flags = detectAbuse({ entries });
		expect(flags.some((f) => f.agent_id === "shaky" && f.rule === "failed_payment_ratio")).toBe(
			true,
		);
	});

	it("does not flag below the minimum sample size", () => {
		vi.stubEnv("ABUSE_FAILED_PAYMENT_RATIO", "0.5");
		vi.stubEnv("ABUSE_FAILED_PAYMENT_MIN", "10");
		const entries = [
			entry({ agent_id: "tiny", action: "checkout.complete", status: "error", status_code: 500 }),
			entry({ agent_id: "tiny", action: "checkout.complete", status: "error", status_code: 500 }),
		];
		const flags = detectAbuse({ entries });
		expect(flags.some((f) => f.rule === "failed_payment_ratio")).toBe(false);
	});
});

describe("detectAbuse — abandonment ratio", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("flags an agent that created many carts and never completed", () => {
		vi.stubEnv("ABUSE_ABANDONMENT_MIN_CARTS", "5");
		const now = Date.now();
		const recent = new Date(now - 60 * 1000).toISOString();
		const entries = Array.from({ length: 6 }, () =>
			entry({ agent_id: "ghost", action: "cart.create", created_at: recent }),
		);
		const flags = detectAbuse({ entries, nowMs: now });
		expect(flags.some((f) => f.agent_id === "ghost" && f.rule === "abandonment_ratio")).toBe(true);
	});

	it("does not flag when the agent completed at least one checkout", () => {
		vi.stubEnv("ABUSE_ABANDONMENT_MIN_CARTS", "5");
		const now = Date.now();
		const recent = new Date(now - 60 * 1000).toISOString();
		const entries = [
			...Array.from({ length: 6 }, () =>
				entry({ agent_id: "real", action: "cart.create", created_at: recent }),
			),
			entry({
				agent_id: "real",
				action: "checkout.complete",
				status: "success",
				status_code: 200,
				created_at: recent,
			}),
		];
		const flags = detectAbuse({ entries, nowMs: now });
		expect(flags.some((f) => f.agent_id === "real" && f.rule === "abandonment_ratio")).toBe(false);
	});
});

describe("detectAbuse — empty input", () => {
	it("returns [] for empty entries", () => {
		expect(detectAbuse({ entries: [] })).toEqual([]);
	});
});
