import { describe, it, expect, beforeEach, vi } from "vitest";

describe("OAuth2 JWT tokens", () => {
	const TEST_SECRET = "test-secret-that-is-at-least-32-characters-long";

	beforeEach(() => {
		vi.stubEnv("OAUTH_JWT_SECRET", TEST_SECRET);
		vi.stubEnv("OAUTH_ACCESS_TOKEN_TTL", "3600");
		vi.stubEnv("OAUTH_REFRESH_TOKEN_TTL", "2592000");
		vi.resetModules();
	});

	async function loadModule() {
		return await import("@/lib/oauth/tokens");
	}

	it("signJwt creates a valid JWT that verifyJwt can decode", async () => {
		const { signJwt, verifyJwt } = await loadModule();

		const token = signJwt(
			{
				sub: "user-123",
				email: "test@example.com",
				scope: "profile checkout",
				client_id: "test-client",
				type: "access",
			},
			3600,
		);

		expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

		const payload = verifyJwt(token);
		expect(payload).not.toBeNull();
		expect(payload!.sub).toBe("user-123");
		expect(payload!.email).toBe("test@example.com");
		expect(payload!.scope).toBe("profile checkout");
		expect(payload!.client_id).toBe("test-client");
		expect(payload!.type).toBe("access");
		expect(payload!.jti).toBeTruthy();
		expect(payload!.iat).toBeTypeOf("number");
		expect(payload!.exp).toBeTypeOf("number");
	});

	it("verifyJwt returns null for tampered tokens", async () => {
		const { signJwt, verifyJwt } = await loadModule();

		const token = signJwt(
			{
				sub: "user-123",
				email: "test@example.com",
				scope: "profile",
				client_id: "test-client",
				type: "access",
			},
			3600,
		);

		// Tamper with the payload part
		const parts = token.split(".");
		const tamperedPayload = Buffer.from(
			JSON.stringify({ sub: "hacker", email: "h@x.com", scope: "profile", client_id: "x", type: "access", jti: "abc", iat: 0, exp: 9999999999 }),
		)
			.toString("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/, "");
		const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

		expect(verifyJwt(tampered)).toBeNull();
	});

	it("verifyJwt returns null for expired tokens", async () => {
		const { signJwt, verifyJwt } = await loadModule();

		vi.useFakeTimers();
		const now = Date.now();
		vi.setSystemTime(now);

		const token = signJwt(
			{
				sub: "user-123",
				email: "test@example.com",
				scope: "profile",
				client_id: "test-client",
				type: "access",
			},
			60, // 60 seconds
		);

		// Advance time past expiry
		vi.setSystemTime(now + 61 * 1000);
		expect(verifyJwt(token)).toBeNull();

		vi.useRealTimers();
	});

	it("createTokenPair returns access + refresh tokens with correct types", async () => {
		const { createTokenPair, verifyJwt } = await loadModule();

		const result = createTokenPair({
			userId: "user-456",
			email: "user@shop.com",
			scope: "profile checkout orders",
			clientId: "my-agent",
			saleorToken: "saleor-access-token-xyz",
			saleorRefreshToken: "saleor-refresh-token-xyz",
		});

		expect(result).toHaveProperty("access_token");
		expect(result).toHaveProperty("refresh_token");
		expect(result).toHaveProperty("expires_in");
		expect(result.expires_in).toBe(3600);

		const accessPayload = verifyJwt(result.access_token);
		expect(accessPayload).not.toBeNull();
		expect(accessPayload!.type).toBe("access");
		expect(accessPayload!.sub).toBe("user-456");
		expect(accessPayload!.saleor_token).toBe("saleor-access-token-xyz");

		const refreshPayload = verifyJwt(result.refresh_token);
		expect(refreshPayload).not.toBeNull();
		expect(refreshPayload!.type).toBe("refresh");
		expect(refreshPayload!.sub).toBe("user-456");
		expect(refreshPayload!.saleor_refresh_token).toBe("saleor-refresh-token-xyz");
	});

	it("revokeRefreshToken + isRefreshTokenRevoked works", async () => {
		const { revokeRefreshToken, isRefreshTokenRevoked } = await loadModule();

		const jti = "test-jti-abc123";

		expect(isRefreshTokenRevoked(jti)).toBe(false);

		revokeRefreshToken(jti);

		expect(isRefreshTokenRevoked(jti)).toBe(true);
	});
});
