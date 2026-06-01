import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyAgentRequest } from "@/lib/protocols/shared/auth";
import { _resetEnvRegistryCache } from "@/lib/protocols/shared/agent-registry";
import { signPayload, getPublicKeyBase64 } from "@/lib/protocols/shared/signing";
import type { AgentIdentity } from "@/lib/protocols/shared/agent-registry-types";

/** Generate a fresh ed25519 keypair via Web Crypto and expose base64 forms. */
async function freshKeypair(): Promise<{ publicKeyBase64: string }> {
	// Reuse the storefront's ephemeral key (signing.ts caches it for the test
	// process). signPayload signs with that key; we expose its public part.
	const publicKeyBase64 = await getPublicKeyBase64();
	return { publicKeyBase64 };
}

function makeAgent(overrides: Partial<AgentIdentity> = {}): AgentIdentity {
	return {
		id: "openai-test",
		display_name: "OpenAI test",
		platform: "openai",
		status: "active",
		public_key: "",
		scope: ["catalog.read", "cart.create", "checkout.complete"],
		spending_limit: { per_session_cents: null, per_day_cents: null, per_month_cents: null },
		rate_limit: { requests_per_minute: 60, sessions_per_day: 500 },
		created_at: "2026-05-01T00:00:00Z",
		updated_at: "2026-05-11T00:00:00Z",
		...overrides,
	};
}

function setRegistry(entries: AgentIdentity[]): void {
	_resetEnvRegistryCache();
	vi.stubEnv("AGENT_REGISTRY_JSON", JSON.stringify(entries));
	vi.stubEnv("PAYLOAD_API_URL", "");
}

function makeRequest(opts: { method?: string; body?: string; headers?: Record<string, string> }): Request {
	return new Request("https://store.example/api/ucp/rest/test", {
		method: opts.method ?? "POST",
		body: opts.body,
		headers: opts.headers,
	});
}

describe("verifyAgentRequest — signed request path", () => {
	let publicKeyBase64: string;

	beforeEach(async () => {
		({ publicKeyBase64 } = await freshKeypair());
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		_resetEnvRegistryCache();
	});

	it("accepts a valid signed request and returns the agent identity", async () => {
		const agent = makeAgent({ id: "openai-prod", public_key: publicKeyBase64 });
		setRegistry([agent]);

		const body = JSON.stringify({ hello: "world" });
		const sig = await signPayload(body);
		const result = await verifyAgentRequest(
			makeRequest({
				body,
				headers: {
					"UCP-Signature": `keyid="x",alg="ed25519",sig="${sig}"`,
					"UCP-Agent": "openai-prod",
				},
			}),
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.agent.id).toBe("openai-prod");
			expect(result.bodyText).toBe(body);
			expect(result.isLegacy).toBe(false);
		}
	});

	it("rejects when signature does not verify (tampered body)", async () => {
		const agent = makeAgent({ public_key: publicKeyBase64 });
		setRegistry([agent]);

		const sig = await signPayload(JSON.stringify({ ok: true }));
		const result = await verifyAgentRequest(
			makeRequest({
				body: JSON.stringify({ ok: false }),
				headers: {
					"UCP-Signature": `keyid="x",alg="ed25519",sig="${sig}"`,
					"UCP-Agent": agent.id,
				},
			}),
		);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/Invalid signature/);
	});

	it("rejects when agent is unknown", async () => {
		setRegistry([]);
		const sig = await signPayload("{}");
		const result = await verifyAgentRequest(
			makeRequest({
				body: "{}",
				headers: {
					"UCP-Signature": `keyid="x",alg="ed25519",sig="${sig}"`,
					"UCP-Agent": "ghost",
				},
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(401);
			expect(result.reason).toMatch(/Unknown agent/);
		}
	});

	it("returns 403 when agent is suspended (vs 401 for unknown)", async () => {
		setRegistry([makeAgent({ id: "naughty", public_key: publicKeyBase64, status: "suspended" })]);
		const sig = await signPayload("{}");
		const result = await verifyAgentRequest(
			makeRequest({
				body: "{}",
				headers: {
					"UCP-Signature": `keyid="x",alg="ed25519",sig="${sig}"`,
					"UCP-Agent": "naughty",
				},
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(403);
			expect(result.reason).toBe("Agent suspended");
		}
	});

	it("rejects malformed UCP-Signature header", async () => {
		setRegistry([makeAgent({ public_key: publicKeyBase64 })]);
		const result = await verifyAgentRequest(
			makeRequest({
				body: "{}",
				headers: {
					"UCP-Signature": "garbage",
					"UCP-Agent": "openai-test",
				},
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/Malformed/);
	});

	it("rejects unsupported signature algorithm", async () => {
		setRegistry([makeAgent({ public_key: publicKeyBase64 })]);
		const result = await verifyAgentRequest(
			makeRequest({
				body: "{}",
				headers: {
					"UCP-Signature": `keyid="x",alg="rsa",sig="abc"`,
					"UCP-Agent": "openai-test",
				},
			}),
		);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/Unsupported/);
	});

	it("extracts profile URL from structured UCP-Agent header", async () => {
		const agent = makeAgent({ id: "openai-prod", public_key: publicKeyBase64 });
		setRegistry([agent]);

		const body = "{}";
		const sig = await signPayload(body);
		const result = await verifyAgentRequest(
			makeRequest({
				body,
				headers: {
					"UCP-Signature": `keyid="x",alg="ed25519",sig="${sig}"`,
					"UCP-Agent": `id="openai-prod",profile="https://openai.com/.well-known/ucp"`,
				},
			}),
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.agent.id).toBe("openai-prod");
			expect(result.profileUrl).toBe("https://openai.com/.well-known/ucp");
		}
	});
});

describe("verifyAgentRequest — legacy bearer fallback (B9 dual-mode)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		_resetEnvRegistryCache();
	});

	it("accepts AGENT_API_KEYS bearer and returns SYNTHETIC_LEGACY_AGENT (with deprecation warn)", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubEnv("AGENT_API_KEYS", "secret-key-1,secret-key-2");
		vi.stubEnv("AGENT_REGISTRY_JSON", "");

		const result = await verifyAgentRequest(
			makeRequest({
				body: "{}",
				headers: { Authorization: "Bearer secret-key-1" },
			}),
		);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.isLegacy).toBe(true);
			expect(result.agent.id).toMatch(/^legacy-bearer:/);
		}
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/DEPRECATED/));
		warn.mockRestore();
	});

	it("rejects unknown bearer token when AGENT_API_KEYS is set", async () => {
		vi.stubEnv("AGENT_API_KEYS", "secret-key-1");
		vi.stubEnv("AGENT_REGISTRY_JSON", "");

		const result = await verifyAgentRequest(
			makeRequest({
				body: "{}",
				headers: { Authorization: "Bearer wrong-key" },
			}),
		);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toMatch(/Invalid bearer/);
	});

	it("accepts any bearer when AGENT_API_KEYS is empty (dev mode)", async () => {
		vi.stubEnv("AGENT_API_KEYS", "");
		vi.stubEnv("AGENT_REGISTRY_JSON", "");

		const result = await verifyAgentRequest(
			makeRequest({
				body: "{}",
				headers: { Authorization: "Bearer dev-anything" },
			}),
		);

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.agent.id).toBe("legacy-bearer:anonymous");
	});

	it("FAILS CLOSED in production when AGENT_API_KEYS is empty (CWE-1188)", async () => {
		vi.stubEnv("AGENT_API_KEYS", "");
		vi.stubEnv("AGENT_REGISTRY_JSON", "");
		vi.stubEnv("NODE_ENV", "production");

		const result = await verifyAgentRequest(
			makeRequest({ body: "{}", headers: { Authorization: "Bearer dev-anything" } }),
		);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.status).toBe(401);
	});

	it("honors UCP_ALLOW_ANONYMOUS_LEGACY=true escape hatch in production", async () => {
		vi.stubEnv("AGENT_API_KEYS", "");
		vi.stubEnv("AGENT_REGISTRY_JSON", "");
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("UCP_ALLOW_ANONYMOUS_LEGACY", "true");

		const result = await verifyAgentRequest(
			makeRequest({ body: "{}", headers: { Authorization: "Bearer dev-anything" } }),
		);

		expect(result.ok).toBe(true);
	});
});

describe("verifyAgentRequest — no auth at all", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		_resetEnvRegistryCache();
	});

	it("returns 401 when neither UCP-Signature nor Authorization is present", async () => {
		const result = await verifyAgentRequest(makeRequest({ body: "{}" }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.status).toBe(401);
			expect(result.reason).toMatch(/Missing/);
		}
	});
});
