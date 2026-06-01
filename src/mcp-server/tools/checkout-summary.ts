/**
 * Checkout summary tools (Phase F7).
 *
 * Paired `get_checkout` + `get_checkout_full` bound to
 * `ui://saleor/checkout-summary.html`. Same auth contract as F6's
 * `get_cart` pair: `api_key` optional, iframe-relayed calls omit it
 * (host preserves agent identity on the HTTP hop, threat-model §3).
 *
 * This file owns `get_checkout`; the legacy version in
 * `tools/checkout.ts` has been removed in F7 to avoid duplicate
 * registration. Mutating tools (`update_checkout`, `complete_checkout`)
 * stay in `tools/checkout.ts` and are app-only.
 */

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_RESOURCES } from "../apps/registry";
import {
	mapCheckoutToCheckoutSummary,
	mapCheckoutToCheckoutSummaryFull,
} from "../apps/checkout-summary-mapper";
import { registerToolPair, pairedAppToolName } from "../apps/paired-tools";
import { wrapAsData } from "../apps/sanitize";
import { saleorQuery, getDefaultChannel } from "../saleor-client";
import { isMcpApiKeyAuthorized } from "./api-key-auth";
import { CHECKOUT_BY_ID_QUERY, type CheckoutByIdData } from "@/lib/protocols/shared/checkout-queries";

const RESOURCE_URI = APP_RESOURCES.checkoutSummary.uri;
const KIND = "checkout-summary";

function validateOptionalApiKey(apiKey: string | undefined) {
	if (isMcpApiKeyAuthorized(apiKey)) return null;
	return {
		content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid or missing api_key" }) }],
	};
}

const inputSchema = {
	checkout_id: z.string().describe("Saleor checkout ID"),
	api_key: z
		.string()
		.optional()
		.describe(
			"Optional agent API key. Iframe calls omit it (host preserves identity); HTTP agents may still pass it.",
		),
	channel: z.string().default(getDefaultChannel()).describe("Sales channel slug"),
};

export function registerCheckoutSummaryTools(server: McpServer) {
	registerToolPair(server, {
		resourceUri: RESOURCE_URI,
		model: {
			name: "get_checkout",
			config: {
				title: "Get checkout summary",
				description:
					"Get the pre-pay checkout summary for visual review. Returns lines, totals, selected + available shipping methods, and status flags (no buyer/address PII — use `get_checkout_full` from the iframe).",
				inputSchema,
			},
			handler: async ({
				checkout_id,
				api_key,
				channel: _channel,
			}: {
				checkout_id: string;
				api_key?: string;
				channel?: string;
			}) => {
				const authFail = validateOptionalApiKey(api_key);
				if (authFail) return authFail;

				const result = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, {
					id: checkout_id,
				});
				if (!result.ok) {
					return { content: [{ type: "text" as const, text: `Error: ${result.error}` }] };
				}
				if (!result.data.checkout) {
					return { content: [{ type: "text" as const, text: "Checkout not found" }] };
				}

				const payload = mapCheckoutToCheckoutSummary(result.data.checkout);
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
			name: pairedAppToolName("get_checkout"),
			config: {
				title: "Get checkout summary (full, app-only)",
				description:
					"App-only paired sibling of `get_checkout`. Same shape + buyer email/phone + shipping_address + billing_address. Iframe calls through `bridge.fetchAppData('get_checkout', {...})`.",
				inputSchema,
			},
			handler: async ({
				checkout_id,
				api_key,
				channel: _channel,
			}: {
				checkout_id: string;
				api_key?: string;
				channel?: string;
			}) => {
				const authFail = validateOptionalApiKey(api_key);
				if (authFail) return authFail;

				const result = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, {
					id: checkout_id,
				});
				if (!result.ok) {
					return { content: [{ type: "text" as const, text: `Error: ${result.error}` }] };
				}
				if (!result.data.checkout) {
					return { content: [{ type: "text" as const, text: "Checkout not found" }] };
				}

				const payload = mapCheckoutToCheckoutSummaryFull(result.data.checkout);
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
