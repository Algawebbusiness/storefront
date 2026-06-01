/**
 * UCP REST — Get order status
 *
 * GET /api/ucp/rest/orders/[id]
 *
 * Returns the order details in protocol format with UCP metadata wrapper.
 */

import { mapOrderToProtocol } from "@/lib/protocols/shared/order-mapper";
import { ORDER_BY_ID_QUERY, type OrderByIdData } from "@/lib/protocols/shared/order-queries";
import { ownsOrder } from "@/lib/protocols/shared/ownership";
import { signedJsonResponse } from "@/lib/protocols/shared/response";
import { withUcpRoute } from "@/lib/protocols/shared/route-handler";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { saleorQuery } from "@/mcp-server/saleor-client";

interface OrderParams {
	id: string;
}

export const GET = withUcpRoute<OrderParams>(
	{
		action: "order.read",
		scope: "order.read",
		resourceId: (p) => p.id,
	},
	async (_request, auth, { id }) => {
		const result = await saleorQuery<OrderByIdData>(ORDER_BY_ID_QUERY, { id });

		if (!result.ok) {
			return signedJsonResponse({ error: { code: "server_error", message: result.error } }, { status: 500 });
		}

		if (!result.data.order) {
			return signedJsonResponse(
				{ error: { code: "not_found", message: `Order ${id} not found` } },
				{ status: 404 },
			);
		}

		// SECURITY (IDOR/BOLA, CWE-639): orders carry customer PII (email,
		// addresses). Only the owning customer (OAuth-scoped) may read them.
		// Agent-only tokens have no customer identity → no ownership. Respond 404
		// (not 403) so we don't confirm the order exists to a non-owner.
		if (!ownsOrder(result.data.order, auth)) {
			return signedJsonResponse(
				{ error: { code: "not_found", message: `Order ${id} not found` } },
				{ status: 404 },
			);
		}

		const ucpMeta = await buildUcpMeta(auth.profileUrl);

		return signedJsonResponse({
			ucp: ucpMeta,
			order: mapOrderToProtocol(result.data.order),
		});
	},
);
