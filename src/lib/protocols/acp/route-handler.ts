/**
 * Declarative ACP route wrapper — the ACP sibling of `withUcpRoute`.
 *
 * ACP routes previously called the deprecated `validateAgentApiKey` directly,
 * which performs NO scope, spending-limit, approval, or activity-log checks —
 * so a whole protocol surface (incl. money-moving checkout completion) bypassed
 * the guard chain (audit Block 4). This wrapper runs the same chain as UCP:
 *
 *   1. `ACP_ENABLED` feature flag — 404 when off.
 *   2. `verifyAgentRequest` — signed / OAuth / (fail-closed) legacy bearer.
 *   3. `hasScope` — 403 when the agent lacks the action's scope.
 *   4. `computeAmountCents` + `checkLimits` — 429 (spending cap / rate limit).
 *   5. `withAgentActivityLog` — every call timed + audited.
 *
 * Difference from `withUcpRoute`: ACP responses are plain JSON (no
 * UCP-Signature envelope / `ucp` meta).
 */

import { withAgentActivityLog, buildRequestSummary } from "@/lib/protocols/shared/agent-log";
import { hasScope } from "@/lib/protocols/shared/agent-registry-types";
import { verifyAgentRequest } from "@/lib/protocols/shared/auth";
import { checkLimits } from "@/lib/protocols/shared/limits";
import type {
	UcpRouteAuth as ProtocolRouteAuth,
	UcpRouteContext,
	UcpRouteOptions,
} from "@/lib/protocols/shared/route-handler";

export type AcpRouteAuth = ProtocolRouteAuth;

export function withAcpRoute<P = Record<string, never>>(
	options: UcpRouteOptions<P>,
	handler: (request: Request, auth: AcpRouteAuth, params: P) => Promise<Response>,
): (request: Request, ctx?: UcpRouteContext<P>) => Promise<Response> {
	return async (request, ctx) => {
		if (process.env.ACP_ENABLED !== "true") {
			return Response.json(
				{ error: { code: "not_found", message: "ACP is not enabled on this store" } },
				{ status: 404 },
			);
		}

		const verify = await verifyAgentRequest(request);
		if (!verify.ok) {
			const code = verify.status === 403 ? "forbidden" : "unauthorized";
			return Response.json({ error: { code, message: verify.reason } }, { status: verify.status });
		}

		if (!hasScope(verify.agent, options.scope)) {
			return Response.json(
				{ error: { code: "forbidden", message: `Agent missing scope: ${options.scope}` } },
				{ status: 403 },
			);
		}

		const params = ctx?.params ? await ctx.params : ({} as P);

		const auth: AcpRouteAuth = {
			agent: verify.agent,
			bodyText: verify.bodyText,
			isLegacy: verify.isLegacy,
			...(verify.profileUrl ? { profileUrl: verify.profileUrl } : {}),
			...(verify.userContext ? { userContext: verify.userContext } : {}),
		};

		let amountCents: number | null = null;
		if (options.computeAmountCents) {
			amountCents = (await options.computeAmountCents(auth, params)) ?? null;
		}

		const sessionId = options.sessionId?.(params) ?? options.resourceId?.(params);
		const limit = await checkLimits(verify.agent, amountCents, sessionId ?? null);
		if (!limit.allowed) {
			const headers = new Headers();
			if (limit.retry_after_s !== undefined) headers.set("Retry-After", String(limit.retry_after_s));
			return Response.json(
				{ error: { code: "rate_limited", message: limit.reason } },
				{ status: 429, headers },
			);
		}

		const resourceId = options.resourceId?.(params);

		return withAgentActivityLog(
			{
				agent_id: verify.agent.id,
				action: options.action,
				scope: options.scope,
				...(resourceId ? { resource_id: resourceId } : {}),
				...(amountCents !== null ? { amount_cents: amountCents } : {}),
				...(verify.bodyText ? { request_summary: buildRequestSummary(verify.bodyText) } : {}),
			},
			() => handler(request, auth, params),
		);
	};
}
