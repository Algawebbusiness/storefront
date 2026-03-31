import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "crypto";

describe("OAuth2 client config", () => {
	const testSecret = "my-super-secret-value";
	const testSecretHash = createHash("sha256").update(testSecret).digest("hex");
	const testRedirectUri = "https://example.com/callback";
	const testRedirectUri2 = "https://example.com/callback2";

	beforeEach(() => {
		vi.resetModules();
		vi.stubEnv("OAUTH_JWT_SECRET", "a-secret-key-that-is-at-least-32-characters");
		vi.stubEnv(
			"OAUTH_CLIENTS",
			`test-client:${testSecretHash}:${testRedirectUri}|${testRedirectUri2}`,
		);
	});

	async function loadModule() {
		return await import("@/lib/oauth/config");
	}

	it("hashClientSecret produces consistent SHA-256 hex", async () => {
		const { hashClientSecret } = await loadModule();
		const hash1 = hashClientSecret("hello");
		const hash2 = hashClientSecret("hello");
		expect(hash1).toBe(hash2);
		expect(hash1).toMatch(/^[0-9a-f]{64}$/);
		expect(hash1).toBe(createHash("sha256").update("hello").digest("hex"));
	});

	it("verifyClientSecret returns true for matching secret", async () => {
		const { getClient, verifyClientSecret } = await loadModule();
		const client = getClient("test-client");
		expect(client).not.toBeNull();
		expect(verifyClientSecret(client!, testSecret)).toBe(true);
	});

	it("verifyClientSecret returns false for wrong secret", async () => {
		const { getClient, verifyClientSecret } = await loadModule();
		const client = getClient("test-client");
		expect(client).not.toBeNull();
		expect(verifyClientSecret(client!, "wrong-secret")).toBe(false);
	});

	it("validateRedirectUri exact match works", async () => {
		const { getClient, validateRedirectUri } = await loadModule();
		const client = getClient("test-client");
		expect(client).not.toBeNull();
		expect(validateRedirectUri(client!, testRedirectUri)).toBe(true);
		expect(validateRedirectUri(client!, testRedirectUri2)).toBe(true);
	});

	it("validateRedirectUri rejects non-registered URIs", async () => {
		const { getClient, validateRedirectUri } = await loadModule();
		const client = getClient("test-client");
		expect(client).not.toBeNull();
		expect(validateRedirectUri(client!, "https://evil.com/callback")).toBe(false);
	});

	it("getClient returns null for unknown client", async () => {
		const { getClient } = await loadModule();
		expect(getClient("nonexistent")).toBeNull();
	});

	it("getJwtSecret throws when not configured", async () => {
		vi.stubEnv("OAUTH_JWT_SECRET", "");
		const { getJwtSecret } = await loadModule();
		expect(() => getJwtSecret()).toThrow("OAUTH_JWT_SECRET must be set");
	});

	it("getJwtSecret throws when too short", async () => {
		vi.stubEnv("OAUTH_JWT_SECRET", "short");
		vi.resetModules();
		const { getJwtSecret } = await import("@/lib/oauth/config");
		expect(() => getJwtSecret()).toThrow("OAUTH_JWT_SECRET must be set");
	});
});
