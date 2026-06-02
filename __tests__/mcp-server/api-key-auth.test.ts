import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isMcpApiKeyAuthorized } from "@/mcp-server/tools/api-key-auth";

describe("isMcpApiKeyAuthorized (fail-closed in production)", () => {
	beforeEach(() => {
		vi.stubEnv("AGENT_API_KEYS", "");
		vi.stubEnv("MCP_TRUST_TRANSPORT", "");
	});
	afterEach(() => vi.unstubAllEnvs());

	it("allows undefined api_key in dev/test (transport-trust)", () => {
		vi.stubEnv("NODE_ENV", "test");
		expect(isMcpApiKeyAuthorized(undefined)).toBe(true);
	});

	it("REJECTS undefined api_key in production by default", () => {
		vi.stubEnv("NODE_ENV", "production");
		expect(isMcpApiKeyAuthorized(undefined)).toBe(false);
	});

	it("allows undefined in production when MCP_TRUST_TRANSPORT=true", () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("MCP_TRUST_TRANSPORT", "true");
		expect(isMcpApiKeyAuthorized(undefined)).toBe(true);
	});

	it("rejects empty AGENT_API_KEYS in production (no auto-trust)", () => {
		vi.stubEnv("NODE_ENV", "production");
		expect(isMcpApiKeyAuthorized("some-key")).toBe(false);
	});

	it("accepts a matching configured key (any environment)", () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("AGENT_API_KEYS", "k1,k2");
		expect(isMcpApiKeyAuthorized("k2")).toBe(true);
	});

	it("rejects a non-matching key when keys are configured", () => {
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("AGENT_API_KEYS", "k1,k2");
		expect(isMcpApiKeyAuthorized("nope")).toBe(false);
	});
});
