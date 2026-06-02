/**
 * Per-agent rate limits and spending caps (Phase B5), backed by the durable
 * store (`@/lib/store`) so counters hold across instances and cold starts.
 *
 *   - requests_per_minute  → fixed-window counter (`INCR` + `EXPIRE`)
 *   - sessions_per_day     → per-day set of session IDs (`SADD`/`SCARD`)
 *   - per_day/per_month spend → cumulative counters, incremented by
 *     `recordSpend()` after a successful charge and read here for the cap check
 *
 * The check returns a discriminated union so the route can early-return 429
 * with a Retry-After header. `null` limit values mean "unlimited".
 *
 * NOTE: `per_session_cents` still caps a single request's amount, not
 * cumulative session spend, and the read-here / record-after-charge sequence is
 * not yet atomic — both are addressed by the reserve/commit work in Block 8.
 */

import type { AgentIdentity } from "./agent-registry-types";
import { getStore, _resetStore } from "@/lib/store";

export type LimitCheckResult = { allowed: true } | { allowed: false; reason: string; retry_after_s?: number };

const PER_MINUTE_WINDOW_S = 60;
const DAY_TTL_S = 90_000; // ~25h, so a per-day key lives just past midnight
const SPEND_DAY_TTL_S = 2 * 24 * 60 * 60;
const SPEND_MONTH_TTL_S = 32 * 24 * 60 * 60;

export async function checkLimits(
	agent: AgentIdentity,
	requestedAmountCents?: number | null,
	sessionId?: string | null,
): Promise<LimitCheckResult> {
	// 1. requests_per_minute
	const rpmCheck = await checkRequestsPerMinute(agent.id, agent.rate_limit.requests_per_minute);
	if (!rpmCheck.allowed) return rpmCheck;

	// 2. sessions_per_day
	if (sessionId) {
		const sessionCheck = await checkSessionsPerDay(agent.id, sessionId, agent.rate_limit.sessions_per_day);
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
			if (monthCap !== null && aggregates.spent_this_month_cents + requestedAmountCents > monthCap) {
				return {
					allowed: false,
					reason: `Month spending cap exceeded (${aggregates.spent_this_month_cents}¢ + ${requestedAmountCents}¢ > ${monthCap}¢)`,
				};
			}
		}
	}

	return { allowed: true };
}

/**
 * Record a committed charge against the agent's day + month spend counters.
 * Call AFTER a successful checkout completion so caps reflect real spend.
 */
export async function recordSpend(agentId: string, amountCents: number): Promise<void> {
	if (!(amountCents > 0)) return;
	const store = getStore();
	const dayKey = `spend:day:${agentId}:${utcDayKey()}`;
	const monthKey = `spend:month:${agentId}:${utcMonthKey()}`;
	await store.incrby(dayKey, amountCents);
	await store.expire(dayKey, SPEND_DAY_TTL_S);
	await store.incrby(monthKey, amountCents);
	await store.expire(monthKey, SPEND_MONTH_TTL_S);
}

// ─────────────────────────── windows ────────────────────────────────────────

async function checkRequestsPerMinute(agentId: string, capPerMinute: number): Promise<LimitCheckResult> {
	if (capPerMinute <= 0) return { allowed: true };
	const store = getStore();
	const nowS = Math.floor(Date.now() / 1000);
	const minute = Math.floor(nowS / 60);
	const key = `rl:rpm:${agentId}:${minute}`;
	const count = await store.incr(key);
	if (count === 1) await store.expire(key, PER_MINUTE_WINDOW_S);
	if (count > capPerMinute) {
		return {
			allowed: false,
			reason: `Rate limit exceeded: ${capPerMinute} req/min`,
			retry_after_s: Math.max(1, PER_MINUTE_WINDOW_S - (nowS % 60)),
		};
	}
	return { allowed: true };
}

async function checkSessionsPerDay(
	agentId: string,
	sessionId: string,
	capPerDay: number,
): Promise<LimitCheckResult> {
	if (capPerDay <= 0) return { allowed: true };
	const store = getStore();
	const key = `rl:sess:${agentId}:${utcDayKey()}`;
	if (await store.sismember(key, sessionId)) return { allowed: true };
	const size = await store.scard(key);
	if (size + 1 > capPerDay) {
		return {
			allowed: false,
			reason: `Sessions/day cap exceeded: ${capPerDay}`,
			retry_after_s: secondsToTomorrow(),
		};
	}
	await store.sadd(key, sessionId);
	await store.expire(key, DAY_TTL_S);
	return { allowed: true };
}

// ─────────────────────────── spend read ─────────────────────────────────────

interface SpentAggregates {
	spent_today_cents: number;
	spent_this_month_cents: number;
}

async function fetchSpentAggregates(agentId: string): Promise<SpentAggregates> {
	const store = getStore();
	const [day, month] = await Promise.all([
		store.get(`spend:day:${agentId}:${utcDayKey()}`),
		store.get(`spend:month:${agentId}:${utcMonthKey()}`),
	]);
	return {
		spent_today_cents: Number(day) || 0,
		spent_this_month_cents: Number(month) || 0,
	};
}

// ─────────────────────────── time helpers ───────────────────────────────────

function utcDayKey(): string {
	return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}
function utcMonthKey(): string {
	return new Date().toISOString().slice(0, 7); // YYYY-MM
}
function secondsToTomorrow(): number {
	const d = new Date();
	d.setUTCHours(24, 0, 0, 0);
	return Math.max(1, Math.ceil((d.getTime() - Date.now()) / 1000));
}

// ─────────────────────────── test helper ────────────────────────────────────

/** Drop durable counters so tests get a clean slate (resets the store singleton). */
export function _resetLimitBuckets(): void {
	_resetStore();
}
