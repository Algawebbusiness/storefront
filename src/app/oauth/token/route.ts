/**
 * OAuth2 token endpoint.
 *
 * Exchanges authorization codes for access/refresh tokens (grant_type=authorization_code).
 * Rotates refresh tokens for new access tokens (grant_type=refresh_token).
 *
 * Security:
 * - Client authentication required (client_id + client_secret)
 * - PKCE verification for authorization_code grant
 * - Authorization codes are single-use
 * - Refresh tokens are single-use (rotated on each exchange)
 * - Timing-safe comparisons for all secrets
 * - No tokens in URL — only POST body
 */

import { getClient, verifyClientSecret } from "@/lib/oauth/config";
import { consumeAuthorizationCode } from "@/lib/oauth/codes";
import { verifyPkce } from "@/lib/oauth/pkce";
import { createTokenPair, verifyJwt, revokeRefreshToken, isRefreshTokenRevoked } from "@/lib/oauth/tokens";

interface TokenRequest {
	grant_type: string;
	code?: string;
	redirect_uri?: string;
	client_id?: string;
	client_secret?: string;
	code_verifier?: string;
	refresh_token?: string;
}

/** Parse both application/x-www-form-urlencoded and application/json */
async function parseBody(request: Request): Promise<TokenRequest> {
	const contentType = request.headers.get("content-type") || "";

	if (contentType.includes("application/x-www-form-urlencoded")) {
		const formData = await request.formData();
		return Object.fromEntries(formData.entries()) as unknown as TokenRequest;
	}

	return (await request.json()) as TokenRequest;
}

export async function POST(request: Request) {
	let body: TokenRequest;
	try {
		body = await parseBody(request);
	} catch {
		return errorResponse("invalid_request", "Malformed request body", 400);
	}

	const { grant_type, client_id, client_secret } = body;

	// ── Validate client credentials ──

	if (!client_id || !client_secret) {
		return errorResponse("invalid_client", "client_id and client_secret are required", 401);
	}

	const client = getClient(client_id);
	if (!client) {
		return errorResponse("invalid_client", "Unknown client", 401);
	}

	if (!verifyClientSecret(client, client_secret)) {
		console.warn(`[OAuth] Invalid client_secret for client=${client_id}`);
		return errorResponse("invalid_client", "Invalid client credentials", 401);
	}

	// ── Route by grant type ──

	switch (grant_type) {
		case "authorization_code":
			return handleAuthorizationCodeGrant(body, client_id);
		case "refresh_token":
			return handleRefreshTokenGrant(body, client_id);
		default:
			return errorResponse("unsupported_grant_type", `Unsupported grant_type: ${grant_type}`, 400);
	}
}

async function handleAuthorizationCodeGrant(body: TokenRequest, clientId: string) {
	const { code, redirect_uri, code_verifier } = body;

	if (!code || !redirect_uri || !code_verifier) {
		return errorResponse("invalid_request", "code, redirect_uri, and code_verifier are required", 400);
	}

	// ── Consume authorization code (single-use) ──

	const stored = consumeAuthorizationCode(code, clientId, redirect_uri);
	if (!stored) {
		console.warn(`[OAuth] Invalid/expired/reused authorization code for client=${clientId}`);
		return errorResponse("invalid_grant", "Invalid, expired, or already-used authorization code", 400);
	}

	// ── Verify PKCE ──

	if (!verifyPkce(code_verifier, stored.codeChallenge, stored.codeChallengeMethod)) {
		console.warn(`[OAuth] PKCE verification failed for client=${clientId}`);
		return errorResponse("invalid_grant", "PKCE verification failed", 400);
	}

	// ── Issue tokens ──

	const tokens = createTokenPair({
		userId: stored.userId,
		email: stored.userEmail,
		scope: stored.scope,
		clientId,
		saleorToken: stored.saleorAccessToken,
		saleorRefreshToken: stored.saleorRefreshToken,
	});

	console.log(`[OAuth] Token issued: client=${clientId} user=${stored.userId} scope=${stored.scope}`);

	return Response.json({
		access_token: tokens.access_token,
		token_type: "Bearer",
		expires_in: tokens.expires_in,
		refresh_token: tokens.refresh_token,
		scope: stored.scope,
	});
}

async function handleRefreshTokenGrant(body: TokenRequest, clientId: string) {
	const { refresh_token } = body;

	if (!refresh_token) {
		return errorResponse("invalid_request", "refresh_token is required", 400);
	}

	// ── Verify refresh token ──

	const payload = verifyJwt(refresh_token);
	if (!payload || payload.type !== "refresh") {
		return errorResponse("invalid_grant", "Invalid refresh token", 400);
	}

	// Check client binding
	if (payload.client_id !== clientId) {
		console.warn(`[OAuth] Refresh token client mismatch: expected=${clientId} got=${payload.client_id}`);
		return errorResponse("invalid_grant", "Token was not issued to this client", 400);
	}

	// Check revocation (single-use rotation)
	if (isRefreshTokenRevoked(payload.jti)) {
		console.warn(`[OAuth] Revoked refresh token reuse attempt: client=${clientId} user=${payload.sub}`);
		return errorResponse("invalid_grant", "Refresh token has been revoked", 400);
	}

	// ── Revoke old token and issue new pair ──

	revokeRefreshToken(payload.jti);

	// Re-use the Saleor refresh token to get new Saleor tokens
	// For simplicity, we create new OAuth tokens with the same Saleor tokens
	// In production, you'd call Saleor tokenRefresh here
	const tokens = createTokenPair({
		userId: payload.sub,
		email: payload.email,
		scope: payload.scope,
		clientId,
		saleorToken: payload.saleor_token || "",
		saleorRefreshToken: payload.saleor_refresh_token || "",
	});

	console.log(`[OAuth] Token refreshed: client=${clientId} user=${payload.sub}`);

	return Response.json({
		access_token: tokens.access_token,
		token_type: "Bearer",
		expires_in: tokens.expires_in,
		refresh_token: tokens.refresh_token,
		scope: payload.scope,
	});
}

function errorResponse(error: string, description: string, status: number): Response {
	return Response.json({ error, error_description: description }, { status });
}
