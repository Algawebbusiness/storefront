import { describe, it, expect, beforeEach, vi } from "vitest";

describe("Authorization code store", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.useRealTimers();
	});

	const baseParams = {
		clientId: "test-client",
		redirectUri: "https://example.com/callback",
		scope: "profile checkout",
		codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
		codeChallengeMethod: "S256" as const,
		saleorAccessToken: "saleor-at",
		saleorRefreshToken: "saleor-rt",
		userId: "user-123",
		userEmail: "user@example.com",
	};

	async function loadModule() {
		return await import("@/lib/oauth/codes");
	}

	it("createAuthorizationCode returns a hex string", async () => {
		const { createAuthorizationCode } = await loadModule();
		const code = createAuthorizationCode(baseParams);
		expect(code).toMatch(/^[0-9a-f]{64}$/);
	});

	it("consumeAuthorizationCode returns stored data for valid code", async () => {
		const { createAuthorizationCode, consumeAuthorizationCode } = await loadModule();
		const code = createAuthorizationCode(baseParams);

		const result = consumeAuthorizationCode(code, "test-client", "https://example.com/callback");
		expect(result).not.toBeNull();
		expect(result!.clientId).toBe("test-client");
		expect(result!.scope).toBe("profile checkout");
		expect(result!.userId).toBe("user-123");
		expect(result!.userEmail).toBe("user@example.com");
		expect(result!.saleorAccessToken).toBe("saleor-at");
	});

	it("consumeAuthorizationCode returns null for wrong clientId", async () => {
		const { createAuthorizationCode, consumeAuthorizationCode } = await loadModule();
		const code = createAuthorizationCode(baseParams);

		const result = consumeAuthorizationCode(code, "wrong-client", "https://example.com/callback");
		expect(result).toBeNull();
	});

	it("consumeAuthorizationCode returns null for wrong redirectUri", async () => {
		const { createAuthorizationCode, consumeAuthorizationCode } = await loadModule();
		const code = createAuthorizationCode(baseParams);

		const result = consumeAuthorizationCode(code, "test-client", "https://evil.com/callback");
		expect(result).toBeNull();
	});

	it("consumeAuthorizationCode returns null on second use (single-use)", async () => {
		const { createAuthorizationCode, consumeAuthorizationCode } = await loadModule();
		const code = createAuthorizationCode(baseParams);

		const first = consumeAuthorizationCode(code, "test-client", "https://example.com/callback");
		expect(first).not.toBeNull();

		const second = consumeAuthorizationCode(code, "test-client", "https://example.com/callback");
		expect(second).toBeNull();
	});

	it("consumeAuthorizationCode returns null for expired codes", async () => {
		vi.useFakeTimers();
		const now = Date.now();
		vi.setSystemTime(now);

		const { createAuthorizationCode, consumeAuthorizationCode } = await loadModule();
		const code = createAuthorizationCode(baseParams);

		// Advance past 5-minute TTL
		vi.setSystemTime(now + 5 * 60 * 1000 + 1);

		const result = consumeAuthorizationCode(code, "test-client", "https://example.com/callback");
		expect(result).toBeNull();

		vi.useRealTimers();
	});
});
