/**
 * Tests for the C9 mandate store helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	_resetMandates,
	createMandate,
	getMandateStatus,
} from "@/lib/protocols/shared/payment-mandates";
import type { AgentIdentity } from "@/lib/protocols/shared/agent-registry-types";

function fakeAgent(id = "agent_a"): AgentIdentity {
	return {
		id,
		display_name: id,
		platform: "openai",
		status: "active",
		public_key: "",
		scope: ["checkout.complete"],
		spending_limit: { per_session_cents: null, per_day_cents: null, per_month_cents: null },
		rate_limit: { requests_per_minute: 60, sessions_per_day: 100 },
		created_at: "2026-05-01T00:00:00Z",
		updated_at: "2026-05-01T00:00:00Z",
	};
}

describe("payment-mandates store", () => {
	beforeEach(() => {
		_resetMandates();
		vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.unstubAllEnvs();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		_resetMandates();
		vi.unstubAllEnvs();
	});

	it("creates an active mandate and returns it from getMandateStatus", async () => {
		const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
		const m = await createMandate({
			agent: fakeAgent(),
			max_per_period_cents: 10_000,
			currency: "USD",
			period: "month",
			expires_at: future,
		});
		expect(m.id).toMatch(/^mnd_[0-9a-f]{32}$/);
		expect(m.status).toBe("active");
		expect(getMandateStatus(m.id)!.status).toBe("active");
	});

	it("returns undefined for unknown mandate ids", () => {
		expect(getMandateStatus("mnd_does_not_exist")).toBeUndefined();
	});

	it("lazily flips active mandates to expired when expires_at passes", async () => {
		const past = new Date(Date.now() - 1).toISOString();
		const m = await createMandate({
			agent: fakeAgent(),
			max_per_period_cents: 100,
			currency: "USD",
			period: "day",
			expires_at: past,
		});
		expect(getMandateStatus(m.id)!.status).toBe("expired");
	});
});
