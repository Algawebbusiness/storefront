/**
 * Abuse detection heuristics (Phase B10).
 *
 * Pure functions over agent activity entries. Returns a list of "flags" —
 * each flag identifies a suspicious pattern with a reason and a severity
 * weight. The cron handler (`/api/cron/abuse-scan/route.ts`) drives this
 * over the latest activity window from Payload, accumulates flags per
 * agent, and either logs them (1 flag/week → warn) or auto-suspends
 * (3 flags/week → set status="suspended" via Payload).
 *
 * Heuristics (each independently configurable via env):
 *   1. RATE SPIKE — requests_per_minute > THRESHOLD_RATE_SPIKE_MULT × baseline
 *   2. DUPLICATE SESSIONS — same session_id seen across N+ different agent_ids
 *   3. ADDRESS SHOTGUN — agent uses > N distinct shipping addresses in 24h
 *      (placeholder: requires PII surfaced to detector — out of scope for
 *      Phase B10, see notes)
 *   4. ABANDONMENT RATIO — many cart.create with zero checkout.complete
 *      after a sustained period
 *   5. FAILED PAYMENT RATIO — > N% checkout.complete attempts ended in
 *      payment failure
 *
 * Phase B10 ships heuristics 1, 4, 5 — they need only the activity log.
 * 2 needs cross-agent correlation (works), 3 needs PII the activity log
 * deliberately doesn't carry (deferred to Phase E).
 */

import type { AgentActivityEntry } from "./agent-log";

export interface AbuseFlag {
	agent_id: string;
	rule: string;
	severity: "low" | "high";
	reason: string;
	evidence_count: number;
}

export interface AbuseScanInput {
	/** All activity entries in the scan window (typically last 1h or 24h). */
	entries: AgentActivityEntry[];
	/** Now, in milliseconds since epoch. Injectable for tests. */
	nowMs?: number;
}

const DEFAULT_RATE_SPIKE_MULT = 5;
const DEFAULT_RATE_BASELINE_RPM = 10;
const DEFAULT_DUPLICATE_SESSION_AGENTS = 3;
const DEFAULT_FAILED_PAYMENT_RATIO = 0.5;
const DEFAULT_FAILED_PAYMENT_MIN_ATTEMPTS = 5;
const DEFAULT_ABANDONMENT_MIN_CARTS = 100;
const DEFAULT_ABANDONMENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Run all heuristics over the entries and return a flat list of flags.
 * Empty input → empty output (no panic on empty windows).
 */
export function detectAbuse(input: AbuseScanInput): AbuseFlag[] {
	const { entries } = input;
	if (entries.length === 0) return [];
	const flags: AbuseFlag[] = [];

	flags.push(...detectRateSpike(entries));
	flags.push(...detectDuplicateSessions(entries));
	flags.push(...detectFailedPaymentRatio(entries));
	flags.push(...detectAbandonmentRatio(entries, input.nowMs ?? Date.now()));

	return flags;
}

// ─────────────────────────────────────────────────────────────────────────────
// Heuristics
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1. RATE SPIKE — agent's requests_per_minute exceeds the configured baseline
 *    multiplied by THRESHOLD_RATE_SPIKE_MULT. Computed over the last full
 *    minute of entries.
 */
function detectRateSpike(entries: AgentActivityEntry[]): AbuseFlag[] {
	const baseline = readNum("ABUSE_BASELINE_RPM", DEFAULT_RATE_BASELINE_RPM);
	const mult = readNum("ABUSE_RATE_SPIKE_MULT", DEFAULT_RATE_SPIKE_MULT);
	const threshold = baseline * mult;
	if (threshold <= 0) return [];

	const lastMinute = entries.filter((e) => {
		if (!e.created_at) return false;
		return Date.now() - new Date(e.created_at).getTime() < 60_000;
	});

	const byAgent = new Map<string, number>();
	for (const e of lastMinute) {
		byAgent.set(e.agent_id, (byAgent.get(e.agent_id) ?? 0) + 1);
	}

	const flags: AbuseFlag[] = [];
	for (const [agent_id, count] of byAgent.entries()) {
		if (count > threshold) {
			flags.push({
				agent_id,
				rule: "rate_spike",
				severity: "high",
				reason: `${count} req/min exceeds ${threshold} (baseline ${baseline} × ${mult})`,
				evidence_count: count,
			});
		}
	}
	return flags;
}

/**
 * 2. DUPLICATE SESSIONS — same session_id observed across multiple agents
 *    (likely token sharing or compromised key).
 */
function detectDuplicateSessions(entries: AgentActivityEntry[]): AbuseFlag[] {
	const min = readNum("ABUSE_DUPLICATE_SESSION_AGENTS", DEFAULT_DUPLICATE_SESSION_AGENTS);
	if (min <= 1) return [];

	// session_id lives in the request_summary string in this minimal impl —
	// the full integration in Phase E will surface it as a typed column.
	// For now, use resource_id as a proxy: a single cart_id touched by
	// multiple agents is the same red flag.
	const agentsByResource = new Map<string, Set<string>>();
	for (const e of entries) {
		if (!e.resource_id) continue;
		const set = agentsByResource.get(e.resource_id) ?? new Set();
		set.add(e.agent_id);
		agentsByResource.set(e.resource_id, set);
	}

	const flaggedAgents = new Map<string, { resources: number }>();
	for (const [, agents] of agentsByResource.entries()) {
		if (agents.size < min) continue;
		for (const a of agents) {
			const existing = flaggedAgents.get(a) ?? { resources: 0 };
			existing.resources += 1;
			flaggedAgents.set(a, existing);
		}
	}

	return Array.from(flaggedAgents.entries()).map(([agent_id, { resources }]) => ({
		agent_id,
		rule: "duplicate_session",
		severity: "high" as const,
		reason: `Resource(s) touched by ${min}+ different agents — possible key sharing`,
		evidence_count: resources,
	}));
}

/**
 * 4. FAILED PAYMENT RATIO — agent's checkout.complete attempts end in
 *    payment_failed at a higher rate than configured. Needs minimum
 *    sample size to avoid noise on small numbers.
 */
function detectFailedPaymentRatio(entries: AgentActivityEntry[]): AbuseFlag[] {
	const ratioThreshold = readFloat("ABUSE_FAILED_PAYMENT_RATIO", DEFAULT_FAILED_PAYMENT_RATIO);
	const minAttempts = readNum("ABUSE_FAILED_PAYMENT_MIN", DEFAULT_FAILED_PAYMENT_MIN_ATTEMPTS);

	const stats = new Map<string, { attempts: number; failed: number }>();
	for (const e of entries) {
		if (e.action !== "checkout.complete") continue;
		const s = stats.get(e.agent_id) ?? { attempts: 0, failed: 0 };
		s.attempts += 1;
		if (e.status === "error" || (e.status === "denied" && e.status_code === 402)) {
			s.failed += 1;
		}
		stats.set(e.agent_id, s);
	}

	const flags: AbuseFlag[] = [];
	for (const [agent_id, s] of stats.entries()) {
		if (s.attempts < minAttempts) continue;
		const ratio = s.failed / s.attempts;
		if (ratio > ratioThreshold) {
			flags.push({
				agent_id,
				rule: "failed_payment_ratio",
				severity: "low",
				reason: `Failed payment ratio ${(ratio * 100).toFixed(0)}% over ${s.attempts} attempts (threshold ${(ratioThreshold * 100).toFixed(0)}%)`,
				evidence_count: s.failed,
			});
		}
	}
	return flags;
}

/**
 * 5. ABANDONMENT RATIO — agent creates many carts but completes none
 *    (sustained over the configured window).
 */
function detectAbandonmentRatio(entries: AgentActivityEntry[], nowMs: number): AbuseFlag[] {
	const minCarts = readNum("ABUSE_ABANDONMENT_MIN_CARTS", DEFAULT_ABANDONMENT_MIN_CARTS);
	const windowMs = DEFAULT_ABANDONMENT_WINDOW_MS;

	const cutoff = nowMs - windowMs;
	const stats = new Map<string, { carts: number; completes: number }>();
	for (const e of entries) {
		if (!e.created_at) continue;
		if (new Date(e.created_at).getTime() < cutoff) continue;
		const s = stats.get(e.agent_id) ?? { carts: 0, completes: 0 };
		if (e.action === "cart.create" && e.status === "success") s.carts += 1;
		if (e.action === "checkout.complete" && e.status === "success") s.completes += 1;
		stats.set(e.agent_id, s);
	}

	const flags: AbuseFlag[] = [];
	for (const [agent_id, s] of stats.entries()) {
		if (s.carts < minCarts) continue;
		if (s.completes === 0) {
			flags.push({
				agent_id,
				rule: "abandonment_ratio",
				severity: "low",
				reason: `Created ${s.carts} carts in 7 days, completed 0`,
				evidence_count: s.carts,
			});
		}
	}
	return flags;
}

// ─────────────────────────────────────────────────────────────────────────────
// Env helpers
// ─────────────────────────────────────────────────────────────────────────────

function readNum(key: string, fallback: number): number {
	const raw = process.env[key];
	if (!raw) return fallback;
	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}

function readFloat(key: string, fallback: number): number {
	const raw = process.env[key];
	if (!raw) return fallback;
	const n = parseFloat(raw);
	return Number.isFinite(n) ? n : fallback;
}
