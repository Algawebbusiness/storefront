/**
 * Order receipt tools (Phase F7).
 *
 * Paired `get_order` + `get_order_full` bound to
 * `ui://saleor/order-receipt.html`. The model variant is the 7-field
 * allow-listed summary (`id, number, status, statusDisplay, currency,
 * total, isPaid`); the app variant carries lines, totals breakdown,
 * delivery method, buyer email, and addresses for the iframe.
 *
 * `api_key` is optional throughout — same iframe-relay contract as the
 * F6 cart-preview pair.
 */

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_RESOURCES } from "../apps/registry";
import { mapOrderToOrderReceipt, mapOrderToOrderReceiptFull } from "../apps/order-receipt-mapper";
import { registerToolPair, pairedAppToolName } from "../apps/paired-tools";
import { wrapAsData } from "../apps/sanitize";
import { saleorQuery } from "../saleor-client";
import { isMcpApiKeyAuthorized } from "./api-key-auth";
import { ORDER_BY_ID_QUERY, type OrderByIdData } from "@/lib/protocols/shared/order-queries";

const RESOURCE_URI = APP_RESOURCES.orderReceipt.uri;
const KIND = "order-receipt";

function validateOptionalApiKey(apiKey: string | undefined) {
	if (isMcpApiKeyAuthorized(apiKey)) return null;
	return {
		content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid or missing api_key" }) }],
	};
}

const inputSchema = {
	order_id: z.string().describe("Saleor order ID"),
	api_key: z
		.string()
		.optional()
		.describe(
			"Optional agent API key. Iframe omits (host preserves identity); HTTP agents may still pass it.",
		),
};

export function registerOrderReceiptTools(server: McpServer) {
	registerToolPair(server, {
		resourceUri: RESOURCE_URI,
		model: {
			name: "get_order",
			config: {
				title: "Get order receipt",
				description:
					"Get a post-pay order receipt. Returns id, number, status, currency, total, isPaid. Use `get_order_full` (app-only) for line items, totals breakdown, and addresses.",
				inputSchema,
			},
			handler: async ({ order_id, api_key }: { order_id: string; api_key?: string }) => {
				const authFail = validateOptionalApiKey(api_key);
				if (authFail) return authFail;

				const result = await saleorQuery<OrderByIdData>(ORDER_BY_ID_QUERY, { id: order_id });
				if (!result.ok) {
					return { content: [{ type: "text" as const, text: `Error: ${result.error}` }] };
				}
				if (!result.data.order) {
					return { content: [{ type: "text" as const, text: "Order not found" }] };
				}

				const payload = mapOrderToOrderReceipt(result.data.order);
				return {
					content: [
						{
							type: "text" as const,
							text: wrapAsData(JSON.stringify(payload, null, 2), KIND),
						},
					],
				};
			},
		},
		app: {
			name: pairedAppToolName("get_order"),
			config: {
				title: "Get order receipt (full, app-only)",
				description:
					"App-only paired sibling of `get_order`. Same shape + lines, totals breakdown, delivery method, buyer email, shipping/billing addresses. Iframe calls through `bridge.fetchAppData('get_order', {...})`.",
				inputSchema,
			},
			handler: async ({ order_id, api_key }: { order_id: string; api_key?: string }) => {
				const authFail = validateOptionalApiKey(api_key);
				if (authFail) return authFail;

				const result = await saleorQuery<OrderByIdData>(ORDER_BY_ID_QUERY, { id: order_id });
				if (!result.ok) {
					return { content: [{ type: "text" as const, text: `Error: ${result.error}` }] };
				}
				if (!result.data.order) {
					return { content: [{ type: "text" as const, text: "Order not found" }] };
				}

				const payload = mapOrderToOrderReceiptFull(result.data.order);
				return {
					content: [
						{
							type: "text" as const,
							text: wrapAsData(JSON.stringify(payload, null, 2), KIND),
						},
					],
				};
			},
		},
	});
}
