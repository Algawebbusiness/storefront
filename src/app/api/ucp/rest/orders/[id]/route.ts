/**
 * UCP REST — Get order status
 *
 * GET /api/ucp/rest/orders/[id]
 *
 * Returns the order details in protocol format with UCP metadata wrapper.
 */

import { validateAgentApiKey } from "@/lib/protocols/shared/auth";
import {
	signedJsonResponse,
	signedProtocolDisabled,
	signedUnauthorized,
} from "@/lib/protocols/shared/response";
import { saleorQuery } from "@/mcp-server/saleor-client";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { ORDER_BY_ID_QUERY, type OrderByIdData } from "@/lib/protocols/shared/order-queries";
import { mapOrderToProtocol } from "@/lib/protocols/shared/order-mapper";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	if (process.env.UCP_ENABLED !== "true") {
		return signedProtocolDisabled("UCP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return signedUnauthorized();
	}

	const { id } = await params;

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

	const ucpMeta = await buildUcpMeta(auth.profileUrl);

	return signedJsonResponse({
		ucp: ucpMeta,
		order: mapOrderToProtocol(result.data.order),
	});
}
