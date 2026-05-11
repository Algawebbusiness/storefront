import { afterEach, describe, expect, it, vi } from "vitest";
import {
	_lastEnvRegistryError,
	_resetEnvRegistryCache,
	getAgentById,
	listActiveAgents,
	listAllAgents,
	lookupAgent,
} from "@/lib/protocols/shared/agent-registry";
import type { AgentIdentity } from "@/lib/protocols/shared/agent-registry-types";

const validAgent: AgentIdentity = {
	id: "openai-chatgpt-prod",
	display_name: "ChatGPT (production)",
	platform: "openai",
	status: "active",
	public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
	scope: ["catalog.read", "cart.create", "checkout.complete"],
	spending_limit: { per_session_cents: 50000, per_day_cents: null, per_month_cents: null },
	rate_limit: { requests_per_minute: 60, sessions_per_day: 500 },
	created_at: "2026-05-01T00:00:00Z",
	updated_at: "2026-05-11T00:00:00Z",
};

const suspendedAgent: AgentIdentity = { ...validAgent, id: "bad-agent", status: "suspended" };
const revokedAgent: AgentIdentity = { ...validAgent, id: "dead-agent", status: "revoked" };

function setRegistry(entries: unknown[]): void {
	_resetEnvRegistryCache();
	vi.stubEnv("AGENT_REGISTRY_JSON", JSON.stringify(entries));
	vi.stubEnv("PAYLOAD_API_URL", "");
}

describe("agent-registry — env JSON loader", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		_resetEnvRegistryCache();
	});

	it("returns null for unknown ID when registry is empty", async () => {
		setRegistry([]);
		expect(await getAgentById("nope")).toBeNull();
	});

	it("returns the agent for a known active ID", async () => {
		setRegistry([validAgent]);
		const agent = await getAgentById(validAgent.id);
		expect(agent).not.toBeNull();
		expect(agent?.id).toBe(validAgent.id);
		expect(agent?.platform).toBe("openai");
	});

	it("lookupAgent returns reason='unknown' for missing ID", async () => {
		setRegistry([validAgent]);
		expect(await lookupAgent("missing")).toEqual({ found: false, reason: "unknown" });
	});

	it("lookupAgent returns reason='suspended' for suspended agent", async () => {
		setRegistry([suspendedAgent]);
		expect(await lookupAgent(suspendedAgent.id)).toEqual({ found: false, reason: "suspended" });
	});

	it("lookupAgent returns reason='revoked' for revoked agent", async () => {
		setRegistry([revokedAgent]);
		expect(await lookupAgent(revokedAgent.id)).toEqual({ found: false, reason: "revoked" });
	});

	it("getAgentById returns null for suspended (active-only convenience wrapper)", async () => {
		setRegistry([suspendedAgent]);
		expect(await getAgentById(suspendedAgent.id)).toBeNull();
	});
});

describe("agent-registry — list helpers", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		_resetEnvRegistryCache();
	});

	it("listActiveAgents filters out suspended and revoked", async () => {
		setRegistry([validAgent, suspendedAgent, revokedAgent]);
		const active = await listActiveAgents();
		expect(active).toHaveLength(1);
		expect(active[0]!.id).toBe(validAgent.id);
	});

	it("listAllAgents returns every entry regardless of status", async () => {
		setRegistry([validAgent, suspendedAgent, revokedAgent]);
		const all = await listAllAgents();
		expect(all).toHaveLength(3);
	});

	it("listActiveAgents on empty registry returns empty array", async () => {
		setRegistry([]);
		expect(await listActiveAgents()).toEqual([]);
	});
});

describe("agent-registry — env malformed input handling", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		_resetEnvRegistryCache();
	});

	it("logs and returns empty when AGENT_REGISTRY_JSON is invalid JSON", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		_resetEnvRegistryCache();
		vi.stubEnv("AGENT_REGISTRY_JSON", "{not valid json");
		vi.stubEnv("PAYLOAD_API_URL", "");
		expect(await listAllAgents()).toEqual([]);
		expect(_lastEnvRegistryError()).toMatch(/failed to parse/);
		warn.mockRestore();
	});

	it("logs and returns empty when AGENT_REGISTRY_JSON is not an array", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		_resetEnvRegistryCache();
		vi.stubEnv("AGENT_REGISTRY_JSON", JSON.stringify({ id: "single-not-array" }));
		vi.stubEnv("PAYLOAD_API_URL", "");
		expect(await listAllAgents()).toEqual([]);
		expect(_lastEnvRegistryError()).toMatch(/must be a JSON array/);
		warn.mockRestore();
	});

	it("skips malformed entries without breaking valid neighbors", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		setRegistry([
			validAgent,
			{ id: "broken", display_name: "missing required fields" },
			{ ...validAgent, id: "second-good", platform: "anthropic" },
		]);
		const all = await listAllAgents();
		expect(all.map((a) => a.id).sort()).toEqual([validAgent.id, "second-good"]);
		warn.mockRestore();
	});

	it("rejects entry with unknown platform value", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		setRegistry([{ ...validAgent, platform: "lazyweb" }]);
		expect(await listAllAgents()).toEqual([]);
		warn.mockRestore();
	});

	it("rejects entry with non-numeric rate_limit", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		setRegistry([
			{ ...validAgent, rate_limit: { requests_per_minute: "many", sessions_per_day: 1 } },
		]);
		expect(await listAllAgents()).toEqual([]);
		warn.mockRestore();
	});

	it("filters unknown scope values out of the scope array", async () => {
		setRegistry([
			{ ...validAgent, scope: ["catalog.read", "do.evil", "checkout.complete"] },
		]);
		const all = await listAllAgents();
		expect(all).toHaveLength(1);
		expect(all[0]!.scope).toEqual(["catalog.read", "checkout.complete"]);
	});
});

describe("agent-registry — env caching", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		_resetEnvRegistryCache();
	});

	it("caches the parsed registry across calls (boot-time work)", async () => {
		setRegistry([validAgent]);
		await listAllAgents();
		// Mutate env without resetting cache — old result must persist.
		vi.stubEnv("AGENT_REGISTRY_JSON", JSON.stringify([]));
		const second = await listAllAgents();
		expect(second).toHaveLength(1);
	});
});
