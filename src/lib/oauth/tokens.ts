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
import { getStore } from "@/lib/store";

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
	/**
	 * Phase B7: registered agent identity (from agent registry) when the
	 * OAuth client is mapped via OAUTH_CLIENT_AGENT_MAPPING. Lets the
	 * resource server (UCP/ACP/MCP) attribute customer-scoped calls to
	 * the agent platform behind them.
	 */
	agent_id?: string;
	type: "access" | "refresh";
	jti: string; // unique token ID (for refresh token rotation + server-side token lookup)
	iat: number;
	exp: number;
}

/** Sign a JWT with HMAC-SHA256, returning the token and its generated jti. */
function makeJwt(
	payload: Omit<JwtPayload, "iat" | "exp" | "jti">,
	expiresIn: number,
): { token: string; jti: string } {
	const secret = getJwtSecret();
	const now = Math.floor(Date.now() / 1000);
	const jti = randomBytes(16).toString("hex");

	const fullPayload: JwtPayload = { ...payload, jti, iat: now, exp: now + expiresIn };

	const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
	const body = base64url(JSON.stringify(fullPayload));
	const signature = createHmac("sha256", secret).update(`${header}.${body}`).digest();

	return { token: `${header}.${body}.${base64url(signature)}`, jti };
}

/** Sign a JWT with HMAC-SHA256. */
export function signJwt(payload: Omit<JwtPayload, "iat" | "exp" | "jti">, expiresIn: number): string {
	return makeJwt(payload, expiresIn).token;
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

/**
 * Create an access + refresh token pair.
 *
 * SECURITY (CWE-522): the customer's Saleor tokens are NOT embedded in the
 * JWTs (they would be readable by anyone holding the base64 token). They are
 * stored server-side keyed by the OAuth token's jti and looked up only where
 * needed (userinfo / refresh), never travelling to the client.
 */
const SALEOR_AT_PREFIX = "oauth:saleor_at:";
const SALEOR_RT_PREFIX = "oauth:saleor_rt:";

export async function createTokenPair(params: {
	userId: string;
	email: string;
	scope: string;
	clientId: string;
	saleorToken: string;
	saleorRefreshToken: string;
	/** Phase B7: optional agent identity bound to this OAuth client. */
	agentId?: string;
}): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
	const basePayload = {
		sub: params.userId,
		email: params.email,
		scope: params.scope,
		client_id: params.clientId,
		...(params.agentId ? { agent_id: params.agentId } : {}),
	};

	const access = makeJwt({ ...basePayload, type: "access" as const }, ACCESS_TOKEN_TTL);
	const refresh = makeJwt({ ...basePayload, type: "refresh" as const }, REFRESH_TOKEN_TTL);

	// Bind the Saleor tokens to the OAuth tokens' jtis, server-side only.
	const store = getStore();
	await store.set(SALEOR_AT_PREFIX + access.jti, params.saleorToken, ACCESS_TOKEN_TTL);
	await store.set(SALEOR_RT_PREFIX + refresh.jti, params.saleorRefreshToken, REFRESH_TOKEN_TTL);

	return { access_token: access.token, refresh_token: refresh.token, expires_in: ACCESS_TOKEN_TTL };
}

/** Look up the Saleor access token bound to an OAuth access token's jti. */
export async function getSaleorAccessToken(jti: string): Promise<string | null> {
	return getStore().get(SALEOR_AT_PREFIX + jti);
}

/** Look up the Saleor refresh token bound to an OAuth refresh token's jti. */
export async function getSaleorRefreshToken(jti: string): Promise<string | null> {
	return getStore().get(SALEOR_RT_PREFIX + jti);
}

/** Drop the Saleor refresh token mapping for a (rotated/revoked) jti. */
export async function deleteSaleorRefreshToken(jti: string): Promise<void> {
	await getStore().del(SALEOR_RT_PREFIX + jti);
}

// ============================================================================
// Refresh Token Rotation — Revocation Tracking
// ============================================================================

/**
 * Revoked refresh-token JTIs, kept in the durable store (`@/lib/store`) so a
 * revoked token is rejected across all instances, not just the one that
 * revoked it. The marker is given the refresh-token TTL, after which the token
 * is expired anyway and the entry can lapse.
 */
const REVOKED_PREFIX = "oauth:revoked:";

/** Revoke a refresh token by its JTI. */
export async function revokeRefreshToken(jti: string): Promise<void> {
	await getStore().set(REVOKED_PREFIX + jti, "1", REFRESH_TOKEN_TTL);
}

/** Check if a refresh token has been revoked. */
export async function isRefreshTokenRevoked(jti: string): Promise<boolean> {
	return (await getStore().get(REVOKED_PREFIX + jti)) !== null;
}
