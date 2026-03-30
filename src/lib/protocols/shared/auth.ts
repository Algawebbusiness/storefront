/**
 * Agent authentication for ACP/UCP protocol endpoints.
 *
 * Validates API keys from Authorization header against AGENT_API_KEYS env var.
 * For UCP, also extracts the UCP-Agent profile URL.
 */

import type { AgentAuthResult } from "./types";

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

/** Validate agent API key from request Authorization header */
export function validateAgentApiKey(request: Request): AgentAuthResult {
	const authHeader = request.headers.get("Authorization");

	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return { valid: false };
	}

	const token = authHeader.slice(7).trim();
	const validKeys = getValidApiKeys();

	// Also check protocol-specific keys
	const acpKey = process.env.ACP_API_KEY;
	if (acpKey && token === acpKey) {
		return { valid: true, agentId: "acp" };
	}

	if (validKeys.size === 0) {
		// No keys configured = auth disabled (development mode)
		return { valid: true, agentId: "anonymous" };
	}

	if (!validKeys.has(token)) {
		return { valid: false };
	}

	// Extract UCP agent profile if present
	const ucpAgentHeader = request.headers.get("UCP-Agent");
	const profileUrl = ucpAgentHeader?.match(/profile="([^"]+)"/)?.[1];

	return {
		valid: true,
		agentId: token.slice(0, 8),
		...(profileUrl && { profileUrl }),
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
