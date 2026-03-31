/**
 * Agent authentication for ACP/UCP protocol endpoints.
 *
 * Supports two auth modes:
 * 1. API key — for agent-level access (AGENT_API_KEYS env var)
 * 2. OAuth2 Bearer JWT — for customer-scoped access (agent acting on behalf of user)
 *
 * When an OAuth2 token is present, the result includes user context
 * (userId, email, saleorToken) for authenticated Saleor mutations.
 */

import type { AgentAuthResult } from "./types";
import { verifyJwt, type JwtPayload } from "@/lib/oauth/tokens";

/** Parse comma-separated API keys from env */
function getValidApiKeys(): Set<string> {
	const keys = process.env.AGENT_API_KEYS || "";
	return new Set(
		keys
			.split(",")
			.map((k) => k.trim())
			.filter(Boolean),
	);
}

/**
 * Validate agent authentication from request Authorization header.
 *
 * Checks in order:
 * 1. OAuth2 JWT (starts with "eyJ") — customer-scoped access
 * 2. ACP-specific API key
 * 3. General agent API keys
 * 4. Dev mode (no keys configured)
 */
export function validateAgentApiKey(request: Request): AgentAuthResult {
	const authHeader = request.headers.get("Authorization");

	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return { valid: false };
	}

	const token = authHeader.slice(7).trim();

	// ── Check for OAuth2 JWT (customer-scoped) ──
	if (token.startsWith("eyJ")) {
		return validateOAuthToken(token, request);
	}

	// ── Check API keys (agent-level) ──
	const validKeys = getValidApiKeys();

	const acpKey = process.env.ACP_API_KEY;
	if (acpKey && token === acpKey) {
		return { valid: true, agentId: "acp" };
	}

	if (validKeys.size === 0) {
		return { valid: true, agentId: "anonymous" };
	}

	if (!validKeys.has(token)) {
		return { valid: false };
	}

	const ucpAgentHeader = request.headers.get("UCP-Agent");
	const profileUrl = ucpAgentHeader?.match(/profile="([^"]+)"/)?.[1];

	return {
		valid: true,
		agentId: token.slice(0, 8),
		...(profileUrl && { profileUrl }),
	};
}

/**
 * Validate an OAuth2 JWT access token.
 * Returns user context for authenticated Saleor mutations.
 */
function validateOAuthToken(token: string, request: Request): AgentAuthResult {
	let payload: JwtPayload | null;
	try {
		payload = verifyJwt(token);
	} catch {
		return { valid: false };
	}

	if (!payload || payload.type !== "access") {
		return { valid: false };
	}

	const ucpAgentHeader = request.headers.get("UCP-Agent");
	const profileUrl = ucpAgentHeader?.match(/profile="([^"]+)"/)?.[1];

	return {
		valid: true,
		agentId: payload.client_id,
		...(profileUrl && { profileUrl }),
		userContext: {
			userId: payload.sub,
			email: payload.email,
			scope: payload.scope,
			saleorToken: payload.saleor_token || "",
		},
	};
}

/** Create a 401 Unauthorized response */
export function unauthorizedResponse(message = "Invalid or missing API key"): Response {
	return Response.json(
		{ error: { code: "unauthorized", message } },
		{
			status: 401,
			headers: { "WWW-Authenticate": "Bearer" },
		},
	);
}

/** Create a 404 response for disabled protocols */
export function protocolDisabledResponse(protocol: string): Response {
	return Response.json(
		{ error: { code: "not_found", message: `${protocol} is not enabled on this store` } },
		{ status: 404 },
	);
}
