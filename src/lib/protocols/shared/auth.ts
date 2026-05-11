/**
 * Agent authentication for ACP/UCP protocol endpoints.
 *
 * Two paths:
 *   1. Signed request (Phase B3, preferred): UCP-Signature + UCP-Agent headers
 *      → look up agent in registry → verify ed25519 signature over raw body.
 *   2. Legacy bearer (Phase B9 dual-mode, deprecated): Authorization: Bearer
 *      <token-from-AGENT_API_KEYS>. Maps to SYNTHETIC_LEGACY_AGENT.
 *   3. OAuth2 JWT (orthogonal): Authorization: Bearer eyJ...
 *      → customer-scoped, returns userContext for Saleor mutations.
 *
 * Use `verifyAgentRequest` for new code (returns AgentIdentity + consumed
 * body). Use `validateAgentApiKey` only for backward-compat call sites that
 * haven't been migrated to the signed flow yet.
 */

import { lookupAgent } from "./agent-registry";
import type { AgentIdentity } from "./agent-registry-types";
import { parseSignatureHeader } from "./response";
import { verifyDetached } from "./signing";
import type { AgentAuthResult } from "./types";
import { verifyJwt, type JwtPayload } from "@/lib/oauth/tokens";

/**
 * Synthetic agent record representing the deprecated AGENT_API_KEYS bearer
 * flow. B9 finalises the migration; until then any legacy bearer caller is
 * mapped to this identity so downstream code (audit log, limits, scope
 * checks) can treat them uniformly.
 *
 * Conservative defaults: full scope (matches old behaviour where any token
 * could do anything), generous spending cap, modest rate limit.
 */
export const SYNTHETIC_LEGACY_AGENT: AgentIdentity = {
	id: "legacy-bearer",
	display_name: "Legacy bearer auth (AGENT_API_KEYS)",
	platform: "custom",
	status: "active",
	public_key: "",
	scope: [
		"catalog.read",
		"cart.create",
		"cart.update",
		"checkout.create",
		"checkout.complete",
		"order.read",
	],
	spending_limit: { per_session_cents: 10_000_00, per_day_cents: null, per_month_cents: null },
	rate_limit: { requests_per_minute: 30, sessions_per_day: 1000 },
	created_at: "2026-05-01T00:00:00Z",
	updated_at: "2026-05-01T00:00:00Z",
};

/** Successful authentication: identified agent + consumed body + optional OAuth user context. */
export interface AgentAuthSuccess {
	ok: true;
	agent: AgentIdentity;
	/** Raw request body, already consumed. Routes JSON.parse this instead of re-reading. */
	bodyText: string;
	/** True when the caller used the legacy bearer path (B9 deprecation log). */
	isLegacy: boolean;
	/** UCP-Agent profile URL when the caller advertised one. */
	profileUrl?: string;
	/** Set when authentication came via OAuth2 (customer-scoped). */
	userContext?: {
		userId: string;
		email: string;
		scope: string;
		saleorToken: string;
	};
}

/** Failed authentication: status code + machine-readable reason. */
export interface AgentAuthFailure {
	ok: false;
	status: 401 | 403;
	reason: string;
}

export type AgentAuthOutcome = AgentAuthSuccess | AgentAuthFailure;

/**
 * Authenticate an incoming UCP/ACP request.
 *
 * Order of checks:
 *   1. UCP-Signature header → look up agent, verify ed25519 over raw body.
 *   2. Authorization: Bearer eyJ... → OAuth2 JWT → customer-scoped access.
 *   3. Authorization: Bearer <token> in AGENT_API_KEYS → SYNTHETIC_LEGACY_AGENT.
 *   4. Otherwise → 401.
 *
 * The body is consumed exactly once (via `request.text()`) and returned
 * in `bodyText` so the caller doesn't need to clone or re-read the stream.
 */
export async function verifyAgentRequest(request: Request): Promise<AgentAuthOutcome> {
	const signatureHeader = request.headers.get("UCP-Signature");
	const agentIdHeader = request.headers.get("UCP-Agent");

	// ── 1. Signed request path (B3 preferred) ──
	if (signatureHeader && agentIdHeader) {
		return verifySignedRequest(request, signatureHeader, agentIdHeader);
	}

	const authHeader = request.headers.get("Authorization");
	if (authHeader && authHeader.startsWith("Bearer ")) {
		const token = authHeader.slice(7).trim();
		const bodyText = await safeReadBody(request);

		// ── 2. OAuth2 JWT (orthogonal customer-scoped path) ──
		if (token.startsWith("eyJ")) {
			return verifyOAuthBearer(token, request, bodyText);
		}

		// ── 3. Legacy bearer fallback (B9 dual-mode) ──
		return verifyLegacyBearer(token, request, bodyText);
	}

	return { ok: false, status: 401, reason: "Missing UCP-Signature or Authorization header" };
}

/**
 * Legacy synchronous wrapper around `Authorization: Bearer` that does NOT
 * verify signed requests or consume the body. Kept for routes that haven't
 * been migrated to `verifyAgentRequest` yet — new code should not use it.
 *
 * @deprecated Use `verifyAgentRequest` instead. Will be removed when all
 *             routes finish the B9 migration.
 */
export function validateAgentApiKey(request: Request): AgentAuthResult {
	const authHeader = request.headers.get("Authorization");

	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return { valid: false };
	}

	const token = authHeader.slice(7).trim();

	if (token.startsWith("eyJ")) {
		return validateOAuthToken(token, request);
	}

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

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

async function verifySignedRequest(
	request: Request,
	signatureHeader: string,
	agentIdHeader: string,
): Promise<AgentAuthOutcome> {
	const parsed = parseSignatureHeader(signatureHeader);
	if (!parsed) {
		return { ok: false, status: 401, reason: "Malformed UCP-Signature header" };
	}
	if (parsed.alg !== "ed25519") {
		return { ok: false, status: 401, reason: `Unsupported signature algorithm: ${parsed.alg}` };
	}

	// UCP-Agent may be a bare ID or a structured value ("id=...,profile=...").
	const agentId = extractAgentId(agentIdHeader);
	const profileUrl = extractProfileUrl(agentIdHeader);

	const lookup = await lookupAgent(agentId);
	if (!lookup.found) {
		const reason =
			lookup.reason === "unknown"
				? "Unknown agent"
				: lookup.reason === "suspended"
					? "Agent suspended"
					: "Agent revoked";
		return { ok: false, status: lookup.reason === "unknown" ? 401 : 403, reason };
	}

	const bodyText = await safeReadBody(request);
	const valid = await verifyDetached(bodyText, parsed.sig, lookup.agent.public_key);
	if (!valid) {
		return { ok: false, status: 401, reason: "Invalid signature" };
	}

	return {
		ok: true,
		agent: lookup.agent,
		bodyText,
		isLegacy: false,
		...(profileUrl ? { profileUrl } : {}),
	};
}

async function verifyOAuthBearer(
	token: string,
	request: Request,
	bodyText: string,
): Promise<AgentAuthOutcome> {
	let payload: JwtPayload | null;
	try {
		payload = verifyJwt(token);
	} catch {
		return { ok: false, status: 401, reason: "Invalid OAuth token" };
	}
	if (!payload || payload.type !== "access") {
		return { ok: false, status: 401, reason: "Invalid OAuth token type" };
	}

	const profileUrl = extractProfileUrl(request.headers.get("UCP-Agent"));

	// Phase B7: if the token carries an agent_id claim, resolve the real
	// AgentIdentity from the registry. Falls back to SYNTHETIC_LEGACY_AGENT
	// stamped with the client_id when no mapping exists.
	let agent: AgentIdentity = {
		...SYNTHETIC_LEGACY_AGENT,
		id: payload.client_id ?? "oauth-bearer",
	};
	let isLegacy = true;
	if (payload.agent_id) {
		const lookup = await lookupAgent(payload.agent_id);
		if (lookup.found) {
			agent = lookup.agent;
			isLegacy = false;
		}
	}

	return {
		ok: true,
		agent,
		bodyText,
		isLegacy,
		...(profileUrl ? { profileUrl } : {}),
		userContext: {
			userId: payload.sub,
			email: payload.email,
			scope: payload.scope,
			saleorToken: payload.saleor_token || "",
		},
	};
}

function verifyLegacyBearer(
	token: string,
	request: Request,
	bodyText: string,
): AgentAuthOutcome {
	const validKeys = getValidApiKeys();
	const acpKey = process.env.ACP_API_KEY;

	if (acpKey && token === acpKey) {
		console.warn("[auth] DEPRECATED: ACP_API_KEY bearer used. Migrate to signed requests (B9).");
		return acceptLegacy(request, bodyText, "acp");
	}

	if (validKeys.size === 0) {
		// Dev mode: no keys configured, accept anyone (preserves legacy behaviour).
		return acceptLegacy(request, bodyText, "anonymous");
	}

	if (!validKeys.has(token)) {
		return { ok: false, status: 401, reason: "Invalid bearer token" };
	}

	console.warn(
		"[auth] DEPRECATED: AGENT_API_KEYS bearer used. Migrate to signed requests (B9). " +
			`Token suffix: ${token.slice(-4)}`,
	);
	return acceptLegacy(request, bodyText, token.slice(0, 8));
}

function acceptLegacy(request: Request, bodyText: string, idSuffix: string): AgentAuthOutcome {
	const profileUrl = extractProfileUrl(request.headers.get("UCP-Agent"));
	return {
		ok: true,
		agent: { ...SYNTHETIC_LEGACY_AGENT, id: `legacy-bearer:${idSuffix}` },
		bodyText,
		isLegacy: true,
		...(profileUrl ? { profileUrl } : {}),
	};
}

async function safeReadBody(request: Request): Promise<string> {
	try {
		return await request.text();
	} catch {
		return "";
	}
}

function extractAgentId(header: string): string {
	// Accept "agent-id" or "id=agent-id,profile=..." or "agent-id;profile=..."
	const idMatch = header.match(/(?:^|[\s,;])id="?([^",;]+)"?/);
	if (idMatch?.[1]) return idMatch[1].trim();
	// Otherwise treat the whole header (minus profile=) as the bare ID.
	return header.split(/[,;]/)[0]!.trim();
}

function extractProfileUrl(header: string | null): string | undefined {
	if (!header) return undefined;
	return header.match(/profile="([^"]+)"/)?.[1];
}

function getValidApiKeys(): Set<string> {
	const keys = process.env.AGENT_API_KEYS || "";
	return new Set(
		keys
			.split(",")
			.map((k) => k.trim())
			.filter(Boolean),
	);
}

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
