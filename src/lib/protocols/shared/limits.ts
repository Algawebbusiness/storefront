/**
 * Per-agent rate limits and spending caps (Phase B5).
 *
 * Two windows, two storage strategies:
 *
 *   1. Short window (per-minute requests) — in-memory `Map<agent_id, …>`.
 *      Resets every 60s. Per-process; multi-instance deploys see drift,
 *      acceptable for rate limiting (occasional over-the-cap is harmless).
 *
 *   2. Long window (per-day sessions, per-day/per-month spending) —
 *      Payload aggregation when available, best-effort skip otherwise.
 *      Phase E may swap this for Redis or database counters.
 *
 * The check returns a discriminated union so the route can early-return 429
 * with a Retry-After header. Spending checks need an estimated amount; pass
 * `requestedAmountCents` when known (cart total at the time of completion).
 *
 * `null` limit values mean "unlimited" — every check passes for that window.
 */

import { payloadFetch } from "@/lib/payload/client";
import type { AgentIdentity } from "./agent-registry-types";

export type LimitCheckResult =
	| { allowed: true }
	| { allowed: false; reason: string; retry_after_s?: number };

interface BucketEntry {
	count: number;
	windowStartMs: number;
}

const PER_MINUTE_WINDOW_MS = 60_000;
const requestBuckets = new Map<string, BucketEntry>();
const sessionBuckets = new Map<string, Set<string>>(); // agent_id → set of session IDs seen today
let sessionBucketsDayStart = startOfUtcDay();

/**
 * Check whether the agent may proceed with this request.
 *
 * Optional `requestedAmountCents` enables spending-cap checks; pass `null`
 * when the request doesn't carry money (catalog read, cart-level CRUD
 * before complete).
 */
export async function checkLimits(
	agent: AgentIdentity,
	requestedAmountCents?: number | null,
	sessionId?: string | null,
): Promise<LimitCheckResult> {
	rotateSessionBucketsIfNewDay();

	// 1. requests_per_minute (in-memory, hot path)
	const rpmCheck = checkRequestsPerMinute(agent.id, agent.rate_limit.requests_per_minute);
	if (!rpmCheck.allowed) return rpmCheck;

	// 2. sessions_per_day (in-memory tally of unique session IDs today)
	if (sessionId) {
		const sessionCheck = checkSessionsPerDay(agent.id, sessionId, agent.rate_limit.sessions_per_day);
		if (!sessionCheck.allowed) return sessionCheck;
	}

	// 3. spending caps — only when an amount is supplied
	if (typeof requestedAmountCents === "number" && requestedAmountCents > 0) {
		const sessionCap = agent.spending_limit.per_session_cents;
		if (sessionCap !== null && requestedAmountCents > sessionCap) {
			return {
				allowed: false,
				reason: `Cart total ${requestedAmountCents}¢ exceeds per-session cap ${sessionCap}¢`,
			};
		}

		// Daily and monthly require historical aggregation.
		const dayCap = agent.spending_limit.per_day_cents;
		const monthCap = agent.spending_limit.per_month_cents;
		if (dayCap !== null || monthCap !== null) {
			const aggregates = await fetchSpentAggregates(agent.id);
			if (dayCap !== null && aggregates.spent_today_cents + requestedAmountCents > dayCap) {
				return {
					allowed: false,
					reason: `Day spending cap exceeded (${aggregates.spent_today_cents}¢ + ${requestedAmountCents}¢ > ${dayCap}¢)`,
				};
			}
			if (
				monthCap !== null &&
				aggregates.spent_this_month_cents + requestedAmountCents > monthCap
			) {
				return {
					allowed: false,
					reason: `Month spending cap exceeded (${aggregates.spent_this_month_cents}¢ + ${requestedAmountCents}¢ > ${monthCap}¢)`,
				};
			}
		}
	}

	return { allowed: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Short window — in-memory
// ─────────────────────────────────────────────────────────────────────────────

function checkRequestsPerMinute(agentId: string, capPerMinute: number): LimitCheckResult {
	if (capPerMinute <= 0) return { allowed: true };
	const now = Date.now();
	const entry = requestBuckets.get(agentId);

	if (!entry || now - entry.windowStartMs >= PER_MINUTE_WINDOW_MS) {
		requestBuckets.set(agentId, { count: 1, windowStartMs: now });
		return { allowed: true };
	}

	if (entry.count + 1 > capPerMinute) {
		const retryAfterMs = PER_MINUTE_WINDOW_MS - (now - entry.windowStartMs);
		return {
			allowed: false,
			reason: `Rate limit exceeded: ${capPerMinute} req/min`,
			retry_after_s: Math.max(1, Math.ceil(retryAfterMs / 1000)),
		};
	}

	entry.count += 1;
	return { allowed: true };
}

function checkSessionsPerDay(
	agentId: string,
	sessionId: string,
	capPerDay: number,
): LimitCheckResult {
	if (capPerDay <= 0) return { allowed: true };
	let bucket = sessionBuckets.get(agentId);
	if (!bucket) {
		bucket = new Set();
		sessionBuckets.set(agentId, bucket);
	}

	if (bucket.has(sessionId)) return { allowed: true };
	if (bucket.size + 1 > capPerDay) {
		return {
			allowed: false,
			reason: `Sessions/day cap exceeded: ${capPerDay}`,
			retry_after_s: secondsToTomorrow(),
		};
	}
	bucket.add(sessionId);
	return { allowed: true };
}

function rotateSessionBucketsIfNewDay(): void {
	const today = startOfUtcDay();
	if (today !== sessionBucketsDayStart) {
		sessionBuckets.clear();
		sessionBucketsDayStart = today;
	}
}

function startOfUtcDay(): number {
	const d = new Date();
	d.setUTCHours(0, 0, 0, 0);
	return d.getTime();
}

function secondsToTomorrow(): number {
	const tomorrow = startOfUtcDay() + 24 * 60 * 60 * 1000;
	return Math.max(1, Math.ceil((tomorrow - Date.now()) / 1000));
}

// ─────────────────────────────────────────────────────────────────────────────
// Long window — Payload aggregation, best-effort
// ─────────────────────────────────────────────────────────────────────────────

interface SpentAggregates {
	spent_today_cents: number;
	spent_this_month_cents: number;
}

interface PayloadAggregateResponse {
	spent_today_cents?: number;
	spent_this_month_cents?: number;
}

/**
 * Pull cumulative spending for an agent from Payload's agent-activity
 * collection. Without Payload, returns zeros — daily/monthly caps then
 * effectively only see the current request. This is documented as a Phase
 * B5 limitation; Phase E ships proper persistent counters.
 */
async function fetchSpentAggregates(agentId: string): Promise<SpentAggregates> {
	if (!process.env.PAYLOAD_API_URL) {
		return { spent_today_cents: 0, spent_this_month_cents: 0 };
	}
	try {
		const escaped = encodeURIComponent(agentId);
		const result = await payloadFetch<PayloadAggregateResponse>(
			`/agent-activity/aggregate?agent_id=${escaped}`,
			60,
		);
		return {
			spent_today_cents: result?.spent_today_cents ?? 0,
			spent_this_month_cents: result?.spent_this_month_cents ?? 0,
		};
	} catch {
		return { spent_today_cents: 0, spent_this_month_cents: 0 };
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Drop in-memory buckets so tests get a clean slate. */
export function _resetLimitBuckets(): void {
	requestBuckets.clear();
	sessionBuckets.clear();
	sessionBucketsDayStart = startOfUtcDay();
}
