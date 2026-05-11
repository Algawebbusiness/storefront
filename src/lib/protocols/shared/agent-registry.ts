/**
 * Agent registry loader (Phase B2).
 *
 * Unified read API over two storage backends:
 *   1. Payload CMS collection `agents` (when PAYLOAD_API_URL is set)
 *   2. Env var `AGENT_REGISTRY_JSON` (always parsed, used as fallback)
 *
 * Lookup order: Payload first, env second. The two are NOT merged — env is a
 * fallback only. If Payload returns a record (even if `status !== active`),
 * env is ignored for that ID.
 *
 * Caches:
 *   - Env JSON parsed once per process (boot-time work).
 *   - Payload responses cached 5 minutes via `payloadFetch` revalidate.
 *
 * Use `lookupAgent(id)` for the discriminated `AgentLookup` shape that
 * preserves the "found but inactive" distinction. Use `getAgentById(id)`
 * when you only care about active agents.
 */

import { payloadFetch } from "@/lib/payload/client";
import type {
	AgentIdentity,
	AgentLookup,
	AgentRateLimit,
	AgentScope,
	AgentSpendingLimit,
} from "./agent-registry-types";

const CACHE_TTL_SECONDS = 300;

let envRegistryCache: AgentIdentity[] | null = null;
let envRegistryParseError: string | null = null;

/**
 * Look up an agent by ID. Returns a discriminated union so callers can
 * distinguish "unknown" from "suspended" / "revoked".
 */
export async function lookupAgent(id: string): Promise<AgentLookup> {
	const fromPayload = await tryPayload(id);
	const candidate = fromPayload ?? findInEnvRegistry(id);
	if (!candidate) return { found: false, reason: "unknown" };
	if (candidate.status === "suspended") return { found: false, reason: "suspended" };
	if (candidate.status === "revoked") return { found: false, reason: "revoked" };
	return { found: true, agent: candidate };
}

/** Return the agent record only if active. Convenience wrapper around `lookupAgent`. */
export async function getAgentById(id: string): Promise<AgentIdentity | null> {
	const result = await lookupAgent(id);
	return result.found ? result.agent : null;
}

/**
 * List every active agent visible to this deployment.
 * Used by B8 (`accepted_platforms` in /.well-known/ucp) and the merchant
 * admin overview.
 */
export async function listActiveAgents(): Promise<AgentIdentity[]> {
	const all = await listAllAgents();
	return all.filter((a) => a.status === "active");
}

/** List every agent record regardless of status — for the merchant admin view. */
export async function listAllAgents(): Promise<AgentIdentity[]> {
	const fromPayload = await tryPayloadList();
	if (fromPayload !== null) return fromPayload;
	return getEnvRegistry();
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

interface PayloadAgentDoc extends AgentIdentity {
	/** Payload internal ID; we don't expose it. */
	_id?: string;
}

interface PayloadListResponse<T> {
	docs: T[];
	totalDocs: number;
}

async function tryPayload(id: string): Promise<AgentIdentity | null> {
	const escaped = encodeURIComponent(id);
	const result = await payloadFetch<PayloadListResponse<PayloadAgentDoc>>(
		`/agents?where[id][equals]=${escaped}&limit=1`,
		CACHE_TTL_SECONDS,
	);
	const doc = result?.docs[0];
	return doc ? normalizePayloadDoc(doc) : null;
}

async function tryPayloadList(): Promise<AgentIdentity[] | null> {
	const result = await payloadFetch<PayloadListResponse<PayloadAgentDoc>>(
		`/agents?limit=200`,
		CACHE_TTL_SECONDS,
	);
	if (result === null) return null;
	return result.docs.map(normalizePayloadDoc);
}

function normalizePayloadDoc(doc: PayloadAgentDoc): AgentIdentity {
	// Drop Payload internals that we don't expose elsewhere.
	const { _id: _internal, ...rest } = doc;
	void _internal;
	return rest;
}

function findInEnvRegistry(id: string): AgentIdentity | null {
	const registry = getEnvRegistry();
	return registry.find((a) => a.id === id) ?? null;
}

function getEnvRegistry(): AgentIdentity[] {
	if (envRegistryCache !== null) return envRegistryCache;
	const raw = process.env.AGENT_REGISTRY_JSON;
	if (!raw) {
		envRegistryCache = [];
		return envRegistryCache;
	}
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) {
			envRegistryParseError = "AGENT_REGISTRY_JSON must be a JSON array of AgentIdentity objects";
			console.warn(`[agent-registry] ${envRegistryParseError}`);
			envRegistryCache = [];
			return envRegistryCache;
		}
		envRegistryCache = parsed.flatMap(coerceAgentIdentity);
		return envRegistryCache;
	} catch (err) {
		envRegistryParseError = `AGENT_REGISTRY_JSON failed to parse: ${err instanceof Error ? err.message : String(err)}`;
		console.warn(`[agent-registry] ${envRegistryParseError}`);
		envRegistryCache = [];
		return envRegistryCache;
	}
}

/**
 * Validate one entry from `AGENT_REGISTRY_JSON`. Returns `[]` for malformed
 * entries (so a single broken row doesn't break the whole registry) and
 * logs a warning so the operator can spot it.
 */
function coerceAgentIdentity(raw: unknown): AgentIdentity[] {
	if (!raw || typeof raw !== "object") return [];
	const r = raw as Record<string, unknown>;

	const id = typeof r.id === "string" ? r.id : null;
	const display_name = typeof r.display_name === "string" ? r.display_name : null;
	const platform = isPlatform(r.platform) ? r.platform : null;
	const status = isStatus(r.status) ? r.status : null;
	const public_key = typeof r.public_key === "string" ? r.public_key : null;
	const scope = Array.isArray(r.scope) ? r.scope.filter(isScope) : null;
	const spending_limit = coerceSpendingLimit(r.spending_limit);
	const rate_limit = coerceRateLimit(r.rate_limit);
	const created_at = typeof r.created_at === "string" ? r.created_at : null;
	const updated_at = typeof r.updated_at === "string" ? r.updated_at : null;

	if (
		id === null ||
		display_name === null ||
		platform === null ||
		status === null ||
		public_key === null ||
		scope === null ||
		spending_limit === null ||
		rate_limit === null ||
		created_at === null ||
		updated_at === null
	) {
		console.warn(`[agent-registry] skipping malformed env entry: id=${String(r.id)}`);
		return [];
	}

	const agent: AgentIdentity = {
		id,
		display_name,
		platform,
		status,
		public_key,
		scope,
		spending_limit,
		rate_limit,
		created_at,
		updated_at,
	};
	if (typeof r.contact_email === "string") agent.contact_email = r.contact_email;
	if (typeof r.notes === "string") agent.notes = r.notes;
	return [agent];
}

function isPlatform(v: unknown): v is AgentIdentity["platform"] {
	return v === "openai" || v === "google" || v === "anthropic" || v === "microsoft" || v === "custom";
}
function isStatus(v: unknown): v is AgentIdentity["status"] {
	return v === "active" || v === "suspended" || v === "revoked";
}
function isScope(v: unknown): v is AgentScope {
	const known: AgentScope[] = [
		"catalog.read",
		"cart.create",
		"cart.update",
		"checkout.create",
		"checkout.complete",
		"order.read",
		"order.return",
		"customer.read",
		"customer.update",
	];
	return typeof v === "string" && (known as string[]).includes(v);
}
function coerceSpendingLimit(v: unknown): AgentSpendingLimit | null {
	if (!v || typeof v !== "object") return null;
	const r = v as Record<string, unknown>;
	const each = (k: string): number | null => {
		const x = r[k];
		if (x === null || typeof x === "number") return (x as number | null) ?? null;
		return null;
	};
	return {
		per_session_cents: each("per_session_cents"),
		per_day_cents: each("per_day_cents"),
		per_month_cents: each("per_month_cents"),
	};
}
function coerceRateLimit(v: unknown): AgentRateLimit | null {
	if (!v || typeof v !== "object") return null;
	const r = v as Record<string, unknown>;
	const rpm = r.requests_per_minute;
	const spd = r.sessions_per_day;
	if (typeof rpm !== "number" || typeof spd !== "number") return null;
	return { requests_per_minute: rpm, sessions_per_day: spd };
}

/**
 * Test-only: drop cached env registry and parse error so the next call
 * re-reads from `process.env`. Used by vitest with `vi.stubEnv`.
 */
export function _resetEnvRegistryCache(): void {
	envRegistryCache = null;
	envRegistryParseError = null;
}

/** Test-only: surface the last parse error for assertion. */
export function _lastEnvRegistryError(): string | null {
	return envRegistryParseError;
}
