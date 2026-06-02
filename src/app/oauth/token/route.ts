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

import { getAgentForOauthClient, getClient, verifyClientSecret } from "@/lib/oauth/config";
import { consumeAuthorizationCode } from "@/lib/oauth/codes";
import { verifyPkce } from "@/lib/oauth/pkce";
import { saleorTokenRefresh } from "@/lib/oauth/saleor-auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
	createTokenPair,
	verifyJwt,
	revokeRefreshToken,
	isRefreshTokenRevoked,
	getSaleorRefreshToken,
	deleteSaleorRefreshToken,
} from "@/lib/oauth/tokens";

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

	// ── Brute-force protection on client_secret / code / refresh guessing (CWE-307) ──
	const ip = clientIp(request);
	const [ipLimit, clientLimit] = await Promise.all([
		rateLimit(`token:ip:${ip}`, 60, 60), // 60 / min per IP
		rateLimit(`token:client:${client_id}`, 120, 60), // 120 / min per client
	]);
	if (!ipLimit.allowed || !clientLimit.allowed) {
		const retry = Math.max(ipLimit.retryAfterSeconds, clientLimit.retryAfterSeconds);
		return Response.json(
			{ error: "slow_down", error_description: "Too many token requests" },
			{ status: 429, headers: { "Retry-After": String(retry) } },
		);
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

	const stored = await consumeAuthorizationCode(code, clientId, redirect_uri);
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

	const agentId = getAgentForOauthClient(clientId) ?? undefined;
	const tokens = await createTokenPair({
		userId: stored.userId,
		email: stored.userEmail,
		scope: stored.scope,
		clientId,
		saleorToken: stored.saleorAccessToken,
		saleorRefreshToken: stored.saleorRefreshToken,
		agentId,
	});

	console.log(
		`[OAuth] Token issued: client=${clientId} user=${stored.userId} scope=${stored.scope}` +
			(agentId ? ` agent=${agentId}` : ""),
	);

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
	if (await isRefreshTokenRevoked(payload.jti)) {
		console.warn(`[OAuth] Revoked refresh token reuse attempt: client=${clientId} user=${payload.sub}`);
		return errorResponse("invalid_grant", "Refresh token has been revoked", 400);
	}

	// ── Look up the server-side Saleor refresh token bound to this jti ──
	// (CWE-522: it is no longer carried inside the JWT.) Missing ⇒ the binding
	// expired or the token predates this scheme ⇒ force re-auth.
	const saleorRefreshToken = await getSaleorRefreshToken(payload.jti);
	if (!saleorRefreshToken) {
		return errorResponse(
			"invalid_grant",
			"Refresh token is no longer valid; re-authentication required",
			400,
		);
	}

	// Exchange the Saleor refresh token for a fresh Saleor access token. If
	// Saleor rejects it (expired/revoked), fail the grant — re-auth required.
	const freshSaleorAccess = await saleorTokenRefresh(saleorRefreshToken);
	if (!freshSaleorAccess) {
		await revokeRefreshToken(payload.jti);
		await deleteSaleorRefreshToken(payload.jti);
		return errorResponse("invalid_grant", "Saleor session expired; re-authentication required", 400);
	}

	// ── Revoke old token (+ its Saleor binding) and issue a new pair ──
	await revokeRefreshToken(payload.jti);
	await deleteSaleorRefreshToken(payload.jti);

	// Preserve agent_id binding across refresh — fall back to current client mapping if absent.
	const agentId = payload.agent_id ?? getAgentForOauthClient(clientId) ?? undefined;
	const tokens = await createTokenPair({
		userId: payload.sub,
		email: payload.email,
		scope: payload.scope,
		clientId,
		saleorToken: freshSaleorAccess,
		saleorRefreshToken,
		agentId,
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
