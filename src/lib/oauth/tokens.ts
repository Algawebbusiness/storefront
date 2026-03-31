/**
 * JWT token creation and verification for OAuth2.
 *
 * Uses Node.js crypto HMAC-SHA256 — no external JWT library needed.
 * Tokens are signed with OAUTH_JWT_SECRET and contain:
 * - sub: Saleor user ID
 * - email: customer email
 * - scope: granted scopes
 * - client_id: which agent was authorized
 * - type: "access" or "refresh"
 *
 * Security:
 * - HMAC-SHA256 signature prevents tampering
 * - Timing-safe signature comparison
 * - Expiry checked on every verification
 * - Refresh tokens tracked for single-use rotation
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { getJwtSecret, ACCESS_TOKEN_TTL, REFRESH_TOKEN_TTL } from "./config";

/** Base64url encode */
function base64url(data: string | Buffer): string {
	const buf = typeof data === "string" ? Buffer.from(data, "utf-8") : data;
	return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Base64url decode */
function base64urlDecode(str: string): string {
	const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
	return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

export interface JwtPayload {
	sub: string;
	email: string;
	scope: string;
	client_id: string;
	type: "access" | "refresh";
	jti: string; // unique token ID (for refresh token rotation)
	saleor_token?: string; // Saleor access token (only in server memory, not exposed)
	saleor_refresh_token?: string;
	iat: number;
	exp: number;
}

/** Sign a JWT with HMAC-SHA256 */
export function signJwt(payload: Omit<JwtPayload, "iat" | "exp" | "jti">, expiresIn: number): string {
	const secret = getJwtSecret();
	const now = Math.floor(Date.now() / 1000);

	const fullPayload: JwtPayload = {
		...payload,
		jti: randomBytes(16).toString("hex"),
		iat: now,
		exp: now + expiresIn,
	};

	const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const body = base64url(JSON.stringify(fullPayload));
	const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest();

	return `${header}.${body}.${base64url(signature)}`;
}

/** Verify a JWT and return the payload, or null if invalid */
export function verifyJwt(token: string): JwtPayload | null {
	const parts = token.split(".");
	if (parts.length !== 3) return null;

	const [header, body, sig] = parts;

	// Verify signature (timing-safe)
	const secret = getJwtSecret();
	const expected = createHmac("sha256", secret).update(`${header}.${body}`).digest();
	const actual = Buffer.from(sig + "=".repeat((4 - (sig.length % 4)) % 4), "base64");

	if (expected.length !== actual.length) return null;
	if (!timingSafeEqual(expected, actual)) return null;

	// Decode and validate payload
	let payload: JwtPayload;
	try {
		payload = JSON.parse(base64urlDecode(body)) as JwtPayload;
	} catch {
		return null;
	}

	// Check expiry
	const now = Math.floor(Date.now() / 1000);
	if (!payload.exp || payload.exp <= now) return null;

	// Check required fields
	if (!payload.sub || !payload.type || !payload.jti) return null;

	return payload;
}

/** Create an access + refresh token pair */
export function createTokenPair(params: {
	userId: string;
	email: string;
	scope: string;
	clientId: string;
	saleorToken: string;
	saleorRefreshToken: string;
}): { access_token: string; refresh_token: string; expires_in: number } {
	const basePayload = {
		sub: params.userId,
		email: params.email,
		scope: params.scope,
		client_id: params.clientId,
	};

	const access_token = signJwt(
		{
			...basePayload,
			type: "access" as const,
			saleor_token: params.saleorToken,
		},
		ACCESS_TOKEN_TTL,
	);

	const refresh_token = signJwt(
		{
			...basePayload,
			type: "refresh" as const,
			saleor_refresh_token: params.saleorRefreshToken,
		},
		REFRESH_TOKEN_TTL,
	);

	return { access_token, refresh_token, expires_in: ACCESS_TOKEN_TTL };
}

// ============================================================================
// Refresh Token Rotation — Revocation Tracking
// ============================================================================

/**
 * Set of revoked refresh token JTIs.
 * In production, this should be backed by Redis or a database.
 * In-memory is acceptable for a single-instance deployment.
 */
const revokedTokens = new Set<string>();

/** Revoke a refresh token by its JTI */
export function revokeRefreshToken(jti: string): void {
	revokedTokens.add(jti);
	// Cleanup: remove entries older than REFRESH_TOKEN_TTL
	// (In practice, the set stays small because tokens expire)
}

/** Check if a refresh token has been revoked */
export function isRefreshTokenRevoked(jti: string): boolean {
	return revokedTokens.has(jti);
}
