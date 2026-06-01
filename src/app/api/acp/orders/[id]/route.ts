/**
 * ACP — Get order status
 *
 * GET /api/acp/orders/[id]
 *
 * Returns the order details in protocol format (no meta wrapper). Runs the
 * `withAcpRoute` guard chain (scope `order.read`) and enforces object-level
 * ownership: only the owning OAuth customer may read an order (orders carry
 * PII), so a non-owner / agent-only token gets 404 (IDOR/BOLA, CWE-639).
 */

import { NextResponse } from "next/server";
import { withAcpRoute } from "@/lib/protocols/acp/route-handler";
import { saleorQuery } from "@/mcp-server/saleor-client";
import { ORDER_BY_ID_QUERY, type OrderByIdData } from "@/lib/protocols/shared/order-queries";
import { mapOrderToProtocol } from "@/lib/protocols/shared/order-mapper";
import { ownsOrder } from "@/lib/protocols/shared/ownership";

interface OrderParams {
	id: string;
}

export const GET = withAcpRoute<OrderParams>(
	{ action: "order.read", scope: "order.read", resourceId: (p) => p.id },
	async (_request, auth, { id }) => {
		const result = await saleorQuery<OrderByIdData>(ORDER_BY_ID_QUERY, { id });

		if (!result.ok) {
			return NextResponse.json({ error: { code: "server_error", message: result.error } }, { status: 500 });
		}

		if (!result.data.order || !ownsOrder(result.data.order, auth)) {
			// 404 (not 403) so we don't confirm the order exists to a non-owner.
			return NextResponse.json(
				{ error: { code: "not_found", message: `Order ${id} not found` } },
				{ status: 404 },
			);
		}

		return NextResponse.json({ order: mapOrderToProtocol(result.data.order) });
	},
);
