/**
 * UCP REST — Create a Machine Payments Protocol mandate (Phase C9 skeleton).
 *
 * POST /api/ucp/rest/payment-mandates
 *
 * Body: {
 *   max_per_period_cents: number,
 *   currency: string,          // ISO 4217, uppercased
 *   period: "day" | "week" | "month",
 *   expires_at: string,        // ISO 8601 timestamp (must be in the future)
 *   description?: string
 * }
 *
 * Response: { mandate_id, status: "active" }
 *
 * Scope required: `checkout.complete` (mandates are essentially deferred
 * checkouts). MPP_ENABLED env must be truthy — otherwise the handler isn't
 * advertised in the profile and we return 404 here.
 */

import { signedJsonResponse } from "@/lib/protocols/shared/response";
import {
	createMandate,
	type MandatePeriod,
} from "@/lib/protocols/shared/payment-mandates";
import { withUcpRoute } from "@/lib/protocols/shared/route-handler";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";

interface CreateMandateBody {
	max_per_period_cents?: number;
	currency?: string;
	period?: string;
	expires_at?: string;
	description?: string;
}

const ALLOWED_PERIODS: ReadonlySet<MandatePeriod> = new Set(["day", "week", "month"]);

export const POST = withUcpRoute(
	{ action: "payment.mandate.create", scope: "checkout.complete" },
	async (_request, auth) => {
		if (!isMppEnabled()) {
			return signedJsonResponse(
				{ error: { code: "not_found", message: "Machine Payments Protocol is not enabled" } },
				{ status: 404 },
			);
		}

		let body: CreateMandateBody;
		try {
			body = JSON.parse(auth.bodyText) as CreateMandateBody;
		} catch {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "Invalid JSON body" } },
				{ status: 400 },
			);
		}

		const amount = body.max_per_period_cents;
		if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
			return signedJsonResponse(
				{
					error: {
						code: "bad_request",
						message: "max_per_period_cents must be a positive integer",
					},
				},
				{ status: 400 },
			);
		}

		const currency = body.currency?.toUpperCase();
		if (!currency || !/^[A-Z]{3}$/.test(currency)) {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "currency must be an ISO 4217 code" } },
				{ status: 400 },
			);
		}

		const period = body.period as MandatePeriod | undefined;
		if (!period || !ALLOWED_PERIODS.has(period)) {
			return signedJsonResponse(
				{
					error: {
						code: "bad_request",
						message: `period must be one of: ${Array.from(ALLOWED_PERIODS).join(", ")}`,
					},
				},
				{ status: 400 },
			);
		}

		if (!body.expires_at) {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "expires_at is required" } },
				{ status: 400 },
			);
		}
		const expiresMs = Date.parse(body.expires_at);
		if (!Number.isFinite(expiresMs) || expiresMs <= Date.now()) {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "expires_at must be a future ISO timestamp" } },
				{ status: 400 },
			);
		}

		const mandate = await createMandate({
			agent: auth.agent,
			max_per_period_cents: amount,
			currency,
			period,
			expires_at: new Date(expiresMs).toISOString(),
			...(body.description ? { description: body.description } : {}),
		});

		const ucpMeta = await buildUcpMeta(auth.profileUrl);
		return signedJsonResponse(
			{
				ucp: ucpMeta,
				mandate_id: mandate.id,
				status: mandate.status,
				max_per_period_cents: mandate.max_per_period_cents,
				currency: mandate.currency,
				period: mandate.period,
				expires_at: mandate.expires_at,
			},
			{ status: 201 },
		);
	},
);

function isMppEnabled(): boolean {
	const raw = process.env.MPP_ENABLED;
	if (!raw) return false;
	const n = raw.trim().toLowerCase();
	return n === "true" || n === "1" || n === "yes";
}
