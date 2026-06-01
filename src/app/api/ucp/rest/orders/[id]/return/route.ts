/**
 * UCP REST — Initiate an order return (Phase C1).
 *
 * POST /api/ucp/rest/orders/:id/return
 *
 * Body: {
 *   reason: "defective" | "not_as_described" | "changed_mind" | "wrong_item",
 *   note?: string,
 *   lines?: { line_id: string, quantity: number }[],   // empty = full order
 *   refund_method: "original_payment" | "store_credit",
 *   webhook_url?: string,
 * }
 *
 * Access:
 *   - The agent must hold `order.return` scope.
 *   - The request must carry an OAuth user-scoped token (only customers can
 *     return their own orders). Agent-only bearer tokens get 403.
 *
 * Saleor mutations (OrderRefund / FulfillmentReturnProducts) wire up in C2;
 * C1 persists the return intent and returns `status: "pending"` with the
 * estimated refund amount.
 */

import { ORDER_BY_ID_QUERY, type OrderByIdData } from "@/lib/protocols/shared/order-queries";
import { ownsOrder } from "@/lib/protocols/shared/ownership";
import { signedJsonResponse } from "@/lib/protocols/shared/response";
import { validateOutboundWebhookUrl } from "@/lib/protocols/shared/url-guard";
import {
	checkReturnEligibility,
	createReturnRecord,
	listReturnsForOrder,
	updateReturnStatus,
	type CreateReturnInput,
	type RefundMethod,
	type ReturnLineRequest,
	type ReturnReason,
} from "@/lib/protocols/shared/return-mapper";
import { triggerSaleorRefund } from "@/lib/protocols/shared/return-queries";
import { withUcpRoute } from "@/lib/protocols/shared/route-handler";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { saleorQuery } from "@/mcp-server/saleor-client";

interface ReturnRouteBody {
	reason?: string;
	note?: string;
	lines?: Array<{ line_id?: string; quantity?: number }>;
	refund_method?: string;
	webhook_url?: string;
}

interface OrderParams {
	id: string;
}

const ALLOWED_REASONS: ReadonlySet<ReturnReason> = new Set([
	"defective",
	"not_as_described",
	"changed_mind",
	"wrong_item",
]);

const ALLOWED_REFUND_METHODS: ReadonlySet<RefundMethod> = new Set(["original_payment", "store_credit"]);

export const POST = withUcpRoute<OrderParams>(
	{
		action: "order.return",
		scope: "order.return",
		resourceId: (p) => p.id,
	},
	async (_request, auth, { id }) => {
		// Returns are customer actions surfaced through an agent. Without an
		// OAuth-bound customer we won't know whose order this is; refuse early.
		if (!auth.userContext) {
			return signedJsonResponse(
				{
					error: {
						code: "oauth_required",
						message: "Order returns require a customer-scoped OAuth token",
					},
				},
				{ status: 403 },
			);
		}

		let body: ReturnRouteBody;
		try {
			body = JSON.parse(auth.bodyText) as ReturnRouteBody;
		} catch {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "Invalid JSON body" } },
				{ status: 400 },
			);
		}

		const reason = body.reason as ReturnReason | undefined;
		if (!reason || !ALLOWED_REASONS.has(reason)) {
			return signedJsonResponse(
				{
					error: {
						code: "bad_request",
						message: `reason must be one of: ${Array.from(ALLOWED_REASONS).join(", ")}`,
					},
				},
				{ status: 400 },
			);
		}

		const refundMethod = body.refund_method as RefundMethod | undefined;
		if (!refundMethod || !ALLOWED_REFUND_METHODS.has(refundMethod)) {
			return signedJsonResponse(
				{
					error: {
						code: "bad_request",
						message: `refund_method must be one of: ${Array.from(ALLOWED_REFUND_METHODS).join(", ")}`,
					},
				},
				{ status: 400 },
			);
		}

		const lines = normalizeRequestedLines(body.lines);
		if (lines === "invalid") {
			return signedJsonResponse(
				{
					error: {
						code: "bad_request",
						message: "lines[] entries must have a line_id and positive integer quantity",
					},
				},
				{ status: 400 },
			);
		}

		// SECURITY (SSRF): the webhook_url is fetched server-side on refund, so
		// validate before persisting it (CWE-918).
		if (body.webhook_url !== undefined) {
			const guard = validateOutboundWebhookUrl(body.webhook_url);
			if (!guard.ok) {
				return signedJsonResponse(
					{ error: { code: "bad_request", message: `webhook_url rejected: ${guard.reason}` } },
					{ status: 400 },
				);
			}
		}

		const orderResult = await saleorQuery<OrderByIdData>(ORDER_BY_ID_QUERY, { id });
		if (!orderResult.ok) {
			return signedJsonResponse(
				{ error: { code: "server_error", message: orderResult.error } },
				{ status: 500 },
			);
		}
		if (!orderResult.data.order) {
			return signedJsonResponse(
				{ error: { code: "not_found", message: `Order ${id} not found` } },
				{ status: 404 },
			);
		}

		const order = orderResult.data.order;

		// SECURITY (IDOR/BOLA, CWE-639): a full-order `original_payment` return
		// triggers a real refund below. Without this check any OAuth customer
		// could refund (and read) ANY order by ID. Require ownership; 404 to a
		// non-owner so we don't confirm the order exists.
		if (!ownsOrder(order, auth)) {
			return signedJsonResponse(
				{ error: { code: "not_found", message: `Order ${id} not found` } },
				{ status: 404 },
			);
		}

		const eligibility = checkReturnEligibility(order, lines, listReturnsForOrder(id));
		if (!eligibility.ok) {
			const status = eligibility.code === "unknown_line" ? 400 : 409;
			return signedJsonResponse(
				{ error: { code: eligibility.code, message: eligibility.message } },
				{ status },
			);
		}

		const input: CreateReturnInput = {
			order_id: id,
			agent_id: auth.agent.id,
			user_id: auth.userContext.userId,
			reason,
			...(body.note ? { note: body.note } : {}),
			...(lines ? { lines } : {}),
			refund_method: refundMethod,
			...(body.webhook_url ? { webhook_url: body.webhook_url } : {}),
		};

		let record = await createReturnRecord(input, order);

		// C2: for full-order returns (no specific lines + original_payment) we
		// trigger the Saleor orderRefund immediately. Partial / store-credit
		// flows stay `pending` and the merchant completes them from Saleor
		// admin until a later phase handles fulfillment-line mapping.
		const isFullOrderRefund = (!lines || lines.length === 0) && refundMethod === "original_payment";
		if (isFullOrderRefund) {
			const refundResult = await triggerSaleorRefund({
				orderId: order.id,
				amountMajorUnits: order.total.gross.amount,
			});
			if (refundResult.ok) {
				// Saleor accepted the refund; webhook (ORDER_REFUNDED) will move
				// us to `refunded` once payment settles.
				record = updateReturnStatus(record.id, "approved") ?? record;
			} else if (refundResult.reason !== "unconfigured") {
				// Real refund failure — surface as 502 so the agent can retry.
				console.warn(`[returns] Saleor refund failed for ${record.id}: ${refundResult.reason}`);
				return signedJsonResponse(
					{
						error: {
							code: "refund_failed",
							message: `Refund could not be initiated: ${refundResult.reason}`,
						},
						return_id: record.id,
					},
					{ status: 502 },
				);
			}
			// `unconfigured` ⇒ keep `pending`; merchant finishes via Saleor admin.
		}

		const ucpMeta = await buildUcpMeta(auth.profileUrl);
		return signedJsonResponse(
			{
				ucp: ucpMeta,
				return_id: record.id,
				status: record.status,
				estimated_refund_cents: record.estimated_refund_cents,
				currency: record.currency,
			},
			{ status: 200 },
		);
	},
);

function normalizeRequestedLines(raw: ReturnRouteBody["lines"]): ReturnLineRequest[] | undefined | "invalid" {
	if (!raw) return undefined;
	if (!Array.isArray(raw)) return "invalid";
	if (raw.length === 0) return undefined;

	const out: ReturnLineRequest[] = [];
	for (const entry of raw) {
		const lineId = entry.line_id;
		const quantity = entry.quantity;
		if (!lineId || typeof quantity !== "number" || !Number.isInteger(quantity) || quantity < 1) {
			return "invalid";
		}
		out.push({ line_id: lineId, quantity });
	}
	return out;
}
