/**
 * Agent registry types — Phase B1.
 *
 * Identity, scope, limits and lifecycle for AI agents that buy from this
 * storefront. The registry has two storage backends:
 *
 *   1. Payload collection `Agents` (primary, per-tenant via multi-tenant plugin)
 *   2. Env JSON `AGENT_REGISTRY_JSON` (fallback when Payload is not deployed)
 *
 * The loader (`agent-registry.ts`, B2) presents a unified API regardless of
 * which backend serves the data. Type contract is identical so the rest of
 * the protocols layer (B3 signed request verification, B4 audit log, B5
 * limits, B6 approvals, B7 OAuth binding) is backend-agnostic.
 *
 * See `docs/agent-registry-design.md` for the rationale.
 */

/**
 * What an agent is allowed to do. Closed enum on purpose — adding a scope is
 * a deliberate change to the security model, not a per-agent string flag.
 *
 * Scope semantics:
 *   - `catalog.read`        Read products, categories, search. Always safe.
 *   - `cart.create`         Create empty / pre-filled carts.
 *   - `cart.update`         Add/remove/update lines, persist context.
 *   - `checkout.create`     Promote cart to checkout-session, set addresses.
 *   - `checkout.complete`   Pay and create the order. The expensive verb.
 *   - `order.read`          Read order status (own orders only via OAuth).
 *   - `order.return`        Initiate returns (Phase C1).
 *   - `customer.read`       Read customer profile — only via OAuth user consent.
 *   - `customer.update`     Mutate customer profile — only via OAuth user consent.
 */
export type AgentScope =
	| "catalog.read"
	| "cart.create"
	| "cart.update"
	| "checkout.create"
	| "checkout.complete"
	| "order.read"
	| "order.return"
	| "customer.read"
	| "customer.update";

/**
 * Platform an agent belongs to. `custom` covers internal Algaweb tooling and
 * unknown third parties; `accepted_platforms` in the public profile (B8) is
 * built from this enum minus `custom`.
 */
export type AgentPlatform = "openai" | "google" | "anthropic" | "microsoft" | "custom";

/**
 * Lifecycle status. `suspended` is reversible (auto-set by abuse detection in
 * B10, can be re-activated by the merchant); `revoked` is terminal (manual
 * action only, e.g. agent platform compromised).
 */
export type AgentStatus = "active" | "suspended" | "revoked";

/**
 * Spending caps in minor units (cents). `null` means unlimited for that
 * window. The registry enforces all three independently — an agent can hit
 * any cap and be blocked.
 */
export interface AgentSpendingLimit {
	per_session_cents: number | null;
	per_day_cents: number | null;
	per_month_cents: number | null;
}

/**
 * Throughput limits. Both are mandatory — the loader rejects an agent
 * record without explicit rate limits to force a deliberate decision.
 */
export interface AgentRateLimit {
	requests_per_minute: number;
	sessions_per_day: number;
}

/** Full agent identity record. */
export interface AgentIdentity {
	/** Unique slug, e.g. `openai-chatgpt-prod`. Stable across deploys. */
	id: string;
	/** Human-readable name shown in OAuth consent screens and Payload admin. */
	display_name: string;
	platform: AgentPlatform;
	status: AgentStatus;
	/**
	 * Base64-encoded raw 32-byte ed25519 public key. Same format as the
	 * `signing_keys[].public_key` we publish in our own profile (A3).
	 *
	 * Empty string allowed only for `SYNTHETIC_LEGACY_AGENT` (B9), which
	 * represents the deprecated `AGENT_API_KEYS` bearer flow.
	 */
	public_key: string;
	scope: AgentScope[];
	spending_limit: AgentSpendingLimit;
	rate_limit: AgentRateLimit;
	contact_email?: string;
	notes?: string;
	created_at: string;
	updated_at: string;
}

/**
 * Result type for the registry loader. Distinguishes between "agent not
 * found" (caller should 401) and "agent found but inactive" (caller should
 * 403 with a different message).
 */
export type AgentLookup =
	| { found: true; agent: AgentIdentity }
	| { found: false; reason: "unknown" | "suspended" | "revoked" };

/** Predicate: does this agent currently hold the given scope? */
export function hasScope(agent: AgentIdentity, scope: AgentScope): boolean {
	return agent.scope.includes(scope);
}

/** Predicate: is this agent in a state where requests should be served? */
export function isActiveAgent(agent: AgentIdentity): boolean {
	return agent.status === "active";
}
