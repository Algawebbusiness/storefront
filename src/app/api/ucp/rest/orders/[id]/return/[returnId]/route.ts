/**
 * UCP REST — Poll return status (Phase C2).
 *
 * GET /api/ucp/rest/orders/:id/return/:returnId
 *
 * Agents that did not register a `webhook_url` poll this endpoint to learn
 * when their pending return transitions through approved → refunded (or
 * rejected). Status changes are driven by the Saleor `ORDER_REFUNDED`
 * webhook.
 *
 * Access:
 *   - `order.return` scope (same as the create endpoint).
 *   - The polling endpoint does NOT require OAuth user context — once a
 *     return exists, the agent that created it should be able to read its
 *     status. We enforce ownership instead: the agent_id on the record
 *     must match the caller's `auth.agent.id`.
 */

import { signedJsonResponse } from "@/lib/protocols/shared/response";
import { getReturnRecord } from "@/lib/protocols/shared/return-mapper";
import { withUcpRoute } from "@/lib/protocols/shared/route-handler";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";

interface ReturnParams {
	id: string;
	returnId: string;
}

export const GET = withUcpRoute<ReturnParams>(
	{
		action: "order.return.read",
		scope: "order.return",
		resourceId: (p) => p.returnId,
	},
	async (_request, auth, { id, returnId }) => {
		const record = getReturnRecord(returnId);
		if (!record || record.order_id !== id) {
			return signedJsonResponse(
				{ error: { code: "not_found", message: `Return ${returnId} not found on order ${id}` } },
				{ status: 404 },
			);
		}

		if (record.agent_id !== auth.agent.id) {
			return signedJsonResponse(
				{ error: { code: "forbidden", message: "Return belongs to a different agent" } },
				{ status: 403 },
			);
		}

		const ucpMeta = await buildUcpMeta(auth.profileUrl);
		return signedJsonResponse({
			ucp: ucpMeta,
			return: {
				id: record.id,
				order_id: record.order_id,
				status: record.status,
				reason: record.reason,
				refund_method: record.refund_method,
				estimated_refund_cents: record.estimated_refund_cents,
				currency: record.currency,
				created_at: record.created_at,
				updated_at: record.updated_at,
			},
		});
	},
);
