/**
 * MCP Apps usage telemetry (Phase F9).
 *
 * Lightweight hook that records when a `ui://` resource is fetched from
 * the MCP server. Piggy-backs on the existing Phase B `logAgentAction`
 * pipeline so the events land in the same `AgentActivity` collection
 * (or the `[agent-log]` structured console line when Payload isn't
 * configured) as every other agent action.
 *
 * Event shape — one entry per resource fetch:
 *
 *     {
 *       agent_id: "anonymous" | <bound>,
 *       action:   "app.view.<resourceKey>",   // e.g. "app.view.cartPreview"
 *       scope:    "catalog.read",
 *       status:   "success",
 *       status_code: 200,
 *       duration_ms: 0,
 *     }
 *
 * Plan-noted caveat: hosts may speculatively pre-fetch every advertised
 * resource on connect, so the event stream can be noisier than per-user
 * view counts. Per-session correlation needs request context that the
 * stateless `/mcp` route doesn't carry — we log unconditionally now and
 * defer dedup to the Phase E control panel.
 *
 * Errors are swallowed: `logAgentAction` is already fire-and-forget; the
 * outer wrapper just guards the call site against an unexpected throw so
 * `loadThemedView` never fails because telemetry did.
 */

import { logAgentAction } from "@/lib/protocols/shared/agent-log";
import type { AppResourceKey } from "./registry";

export function logAppView(view: AppResourceKey, agentId?: string): void {
	try {
		logAgentAction({
			agent_id: agentId ?? "anonymous",
			action: `app.view.${view}`,
			scope: "catalog.read",
			status: "success",
			status_code: 200,
			duration_ms: 0,
		});
	} catch {
		// Telemetry is best-effort. A failure here must never break the
		// resource serve path — the iframe still needs to render.
	}
}
