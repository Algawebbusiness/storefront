/**
 * Abuse detection scheduled scan (Phase B10).
 *
 * GET /api/cron/abuse-scan
 *
 * Designed to be invoked by a scheduler:
 *   - Vercel Cron (vercel.json: `crons: [{ path: "/api/cron/abuse-scan", schedule: "0 * * * *" }]`)
 *   - Cloudflare Cron Trigger
 *   - External scheduler (curl from cron / GitHub Actions)
 *
 * Auth: bearer token in `Authorization: Bearer <CRON_SECRET>`. Returns 401
 * without it (so a stray public crawl doesn't trigger expensive Payload
 * scans).
 *
 * Behaviour:
 *   1. Pull recent activity from Payload (best-effort: returns 503 if
 *      Payload is not configured — abuse detection genuinely needs a
 *      persistent log).
 *   2. Run heuristics from `abuse-detection.ts`.
 *   3. Group flags per agent. 1+ flag → log warning + (optional) email
 *      via Resend. 3+ flags in the scan window → write status="suspended"
 *      back to Payload.
 *
 * Output: JSON summary { scanned, flagged, suspended }.
 */

import { detectAbuse, type AbuseFlag } from "@/lib/protocols/shared/abuse-detection";
import type { AgentActivityEntry } from "@/lib/protocols/shared/agent-log";
import { timingSafeEqualStr } from "@/lib/timing-safe-equal";

const CRON_SECRET = process.env.CRON_SECRET;
const PAYLOAD_API_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL
	? process.env.PAYLOAD_API_URL
	: process.env.PAYLOAD_API_URL;
const PAYLOAD_API_KEY = process.env.PAYLOAD_API_KEY;
const ABUSE_AUTO_SUSPEND_THRESHOLD = Number(process.env.ABUSE_AUTO_SUSPEND_THRESHOLD || 3);

interface ScanResult {
	scanned_entries: number;
	flagged_agents: number;
	suspended_agents: number;
	flags: AbuseFlag[];
}

export async function GET(request: Request): Promise<Response> {
	if (!authorized(request)) {
		return Response.json({ error: "unauthorized" }, { status: 401 });
	}

	if (!PAYLOAD_API_URL) {
		return Response.json(
			{
				error: "payload_required",
				message:
					"Abuse detection needs Payload to read the activity log and write agent suspensions. Set PAYLOAD_API_URL.",
			},
			{ status: 503 },
		);
	}

	const entries = await fetchRecentActivity();
	const flags = detectAbuse({ entries });

	// Group by agent
	const byAgent = new Map<string, AbuseFlag[]>();
	for (const f of flags) {
		const list = byAgent.get(f.agent_id) ?? [];
		list.push(f);
		byAgent.set(f.agent_id, list);
	}

	let suspended = 0;
	for (const [agent_id, list] of byAgent.entries()) {
		console.warn(`[abuse] agent=${agent_id} flags=${list.length} rules=${list.map((f) => f.rule).join(",")}`);

		if (list.length >= ABUSE_AUTO_SUSPEND_THRESHOLD) {
			const ok = await suspendAgent(agent_id, list);
			if (ok) suspended += 1;
		}
	}

	const result: ScanResult = {
		scanned_entries: entries.length,
		flagged_agents: byAgent.size,
		suspended_agents: suspended,
		flags,
	};
	return Response.json(result);
}

function authorized(request: Request): boolean {
	if (!CRON_SECRET) return false;
	const header = request.headers.get("Authorization");
	if (!header || !header.startsWith("Bearer ")) return false;
	return timingSafeEqualStr(header.slice(7).trim(), CRON_SECRET);
}

async function fetchRecentActivity(): Promise<AgentActivityEntry[]> {
	const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const url = `${PAYLOAD_API_URL}/agent-activity?where[created_at][greater_than]=${encodeURIComponent(
		since,
	)}&limit=1000&sort=-created_at`;
	try {
		const res = await fetch(url, {
			headers: PAYLOAD_API_KEY ? { Authorization: `users API-Key ${PAYLOAD_API_KEY}` } : {},
		});
		if (!res.ok) return [];
		const json = (await res.json()) as { docs?: AgentActivityEntry[] };
		return json.docs ?? [];
	} catch {
		return [];
	}
}

async function suspendAgent(agentId: string, evidence: AbuseFlag[]): Promise<boolean> {
	try {
		const res = await fetch(`${PAYLOAD_API_URL}/agents?where[id][equals]=${encodeURIComponent(agentId)}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				...(PAYLOAD_API_KEY ? { Authorization: `users API-Key ${PAYLOAD_API_KEY}` } : {}),
			},
			body: JSON.stringify({
				status: "suspended",
				notes: `Auto-suspended ${new Date().toISOString()} — ${evidence.length} abuse flags: ${evidence
					.map((e) => e.rule)
					.join(", ")}`,
			}),
		});
		if (!res.ok) {
			console.warn(`[abuse] failed to suspend ${agentId}: HTTP ${res.status}`);
			return false;
		}
		console.warn(`[abuse] AUTO-SUSPENDED agent=${agentId}`);
		return true;
	} catch (err) {
		console.warn(
			`[abuse] suspend exception for ${agentId}: ${err instanceof Error ? err.message : String(err)}`,
		);
		return false;
	}
}
