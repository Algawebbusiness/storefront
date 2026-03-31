/**
 * ACP — Get order status
 *
 * GET /api/acp/orders/[id]
 *
 * Returns the order details in protocol format (no meta wrapper).
 */

import { NextResponse } from "next/server";
import { validateAgentApiKey, unauthorizedResponse, protocolDisabledResponse } from "@/lib/protocols/shared/auth";
import { saleorQuery } from "@/mcp-server/saleor-client";
import { ORDER_BY_ID_QUERY, type OrderByIdData } from "@/lib/protocols/shared/order-queries";
import { mapOrderToProtocol } from "@/lib/protocols/shared/order-mapper";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	if (process.env.ACP_ENABLED !== "true") {
		return protocolDisabledResponse("ACP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return unauthorizedResponse();
	}

	const { id } = await params;

	const result = await saleorQuery<OrderByIdData>(ORDER_BY_ID_QUERY, { id });

	if (!result.ok) {
		return NextResponse.json(
			{ error: { code: "server_error", message: result.error } },
			{ status: 500 },
		);
	}

	if (!result.data.order) {
		return NextResponse.json(
			{ error: { code: "not_found", message: `Order ${id} not found` } },
			{ status: 404 },
		);
	}

	return NextResponse.json({
		order: mapOrderToProtocol(result.data.order),
	});
}
