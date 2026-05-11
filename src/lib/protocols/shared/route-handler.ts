/**
 * Declarative UCP route wrapper.
 *
 * Combines four cross-cutting concerns into a single helper so routes can
 * focus on *what* they do (the Saleor calls + response mapping) instead of
 * *how* they're guarded:
 *
 *   1. `UCP_ENABLED` feature flag — 404 when off.
 *   2. `verifyAgentRequest` — signed request / OAuth / legacy bearer.
 *   3. `hasScope` — 403 when the agent doesn't hold the action's scope.
 *   4. `checkLimits` — 429 with `Retry-After` when rate-limited or capped.
 *   5. `withAgentActivityLog` — every call timed + audit-logged.
 *
 * The handler receives the verified agent identity, the consumed body text
 * (already read by `verifyAgentRequest`), and the resolved route params.
 * It returns a `Response` exactly like a bare Next.js handler would.
 *
 * For routes whose response status depends on the cart total (B5 spending
 * cap on `checkout.complete`), pass `computeAmountCents` — the wrapper
 * calls it after auth/scope but before `checkLimits`, so a 429 fires
 * before any Saleor mutation runs.
 */

import { buildRequestSummary, withAgentActivityLog } from "./agent-log";
import { hasScope, type AgentIdentity, type AgentScope } from "./agent-registry-types";
import { verifyAgentRequest, type AgentAuthSuccess } from "./auth";
import { checkLimits } from "./limits";
import {
	signedJsonResponse,
	signedProtocolDisabled,
	signedUnauthorized,
} from "./response";

/**
 * Subset of `AgentAuthSuccess` exposed to route handlers. Drops `ok` (always
 * true here) and renames so handlers don't need to import the auth module.
 */
export interface UcpRouteAuth {
	agent: AgentIdentity;
	bodyText: string;
	isLegacy: boolean;
	profileUrl?: string;
	userContext?: AgentAuthSuccess["userContext"];
}

/** Async params shape Next.js 15+ App Router passes to dynamic routes. */
export interface UcpRouteContext<P> {
	params: Promise<P>;
}

export interface UcpRouteOptions<P> {
	/** Action verb logged on every call, e.g. `cart.create`, `checkout.complete`. */
	action: string;
	/**
	 * Scope the agent must hold. `null` skips the scope guard for endpoints
	 * that don't gate on scope (none currently — all UCP routes have one).
	 */
	scope: AgentScope;
	/**
	 * Compute the resource ID to log (cart_id, checkout_id, order_id). Most
	 * routes pull it from `params`; the wrapper passes the resolved params.
	 */
	resourceId?: (params: P) => string | undefined;
	/**
	 * Compute the session ID for `sessions_per_day` tracking. Optional;
	 * defaults to the resource ID, which for UCP cart/checkout flows is the
	 * Saleor checkout ID — a reasonable session proxy.
	 */
	sessionId?: (params: P) => string | undefined;
	/**
	 * Compute the cart total in cents for spending-cap enforcement. Only
	 * needed on routes that mutate money (B5 says: `checkout.complete`).
	 *
	 * Return `null` when the amount isn't applicable (e.g., the cart could
	 * not be fetched — let the handler surface the 404). The wrapper then
	 * skips the spending check but still enforces rate / sessions.
	 */
	computeAmountCents?: (
		auth: UcpRouteAuth,
		params: P,
	) => Promise<number | null> | number | null;
}

export type UcpRouteHandler<P> = (
	request: Request,
	auth: UcpRouteAuth,
	params: P,
) => Promise<Response>;

/**
 * Wrap a Next.js route handler with the full UCP guard chain.
 *
 * Use as the export of a route file:
 *
 * ```ts
 * export const POST = withUcpRoute(
 *   { action: "cart.create", scope: "cart.create" },
 *   async (request, auth, _params) => { ... },
 * );
 * ```
 */
export function withUcpRoute<P = Record<string, never>>(
	options: UcpRouteOptions<P>,
	handler: UcpRouteHandler<P>,
): (request: Request, ctx?: UcpRouteContext<P>) => Promise<Response> {
	return async (request, ctx) => {
		if (process.env.UCP_ENABLED !== "true") {
			return signedProtocolDisabled("UCP");
		}

		const verify = await verifyAgentRequest(request);
		if (!verify.ok) {
			return verify.status === 403
				? signedForbidden(verify.reason)
				: signedUnauthorized(verify.reason);
		}

		if (!hasScope(verify.agent, options.scope)) {
			return signedForbidden(`Agent missing scope: ${options.scope}`);
		}

		const params = (ctx?.params ? await ctx.params : ({} as P));

		const auth: UcpRouteAuth = {
			agent: verify.agent,
			bodyText: verify.bodyText,
			isLegacy: verify.isLegacy,
			...(verify.profileUrl ? { profileUrl: verify.profileUrl } : {}),
			...(verify.userContext ? { userContext: verify.userContext } : {}),
		};

		// Spending-cap inputs are computed before the rate-limit check so a
		// blocked cart total surfaces as a single 429 instead of leaking into
		// downstream handler state.
		let amountCents: number | null = null;
		if (options.computeAmountCents) {
			amountCents = (await options.computeAmountCents(auth, params)) ?? null;
		}

		const sessionId = options.sessionId?.(params) ?? options.resourceId?.(params);
		const limit = await checkLimits(verify.agent, amountCents, sessionId ?? null);
		if (!limit.allowed) {
			const headers = new Headers();
			if (limit.retry_after_s !== undefined) {
				headers.set("Retry-After", String(limit.retry_after_s));
			}
			return signedJsonResponse(
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
				...(verify.bodyText
					? { request_summary: buildRequestSummary(verify.bodyText) }
					: {}),
			},
			() => handler(request, auth, params),
		);
	};
}

/**
 * Signed 403 — used when an agent is authenticated but lacks the required
 * scope, or when verifyAgentRequest itself returned 403 (suspended/revoked).
 */
async function signedForbidden(message: string): Promise<Response> {
	return signedJsonResponse(
		{ error: { code: "forbidden", message } },
		{ status: 403 },
	);
}
