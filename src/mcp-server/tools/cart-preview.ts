/**
 * Cart preview tools (Phase F6) — first usage of `registerToolPair`.
 *
 * Three tools all bound to `ui://saleor/cart-preview.html`:
 *
 *   - `get_cart`           (paired model, default visibility)
 *     returns `CartPreviewPayload` — no PII; gates the model's reasoning
 *     about cart state with boolean flags only (`hasEmail`, ...).
 *
 *   - `get_cart_full`      (paired app, `visibility: ["app"]`)
 *     returns `CartPreviewFullPayload` — adds `buyer` + addresses. Hidden
 *     from `tools/list`, callable only from the iframe via
 *     `bridge.fetchAppData("get_cart", {...})` (the bridge auto-appends
 *     `_full` per `pairedAppToolName` convention).
 *
 *   - `update_cart_line`   (standalone app-only, `visibility: ["app"]`)
 *     `quantity > 0` → `checkoutLinesUpdate`; `quantity === 0` →
 *     `checkoutLinesDelete`. Returns the refreshed `CartPreviewPayload`
 *     so the iframe re-renders against authoritative totals.
 *
 * Auth: all three accept `api_key` as **optional**. When supplied, it's
 * validated against `AGENT_API_KEYS` (the legacy MCP transport contract).
 * When omitted, the call must already be authenticated upstream — the
 * iframe never has the agent key (security boundary, threat-model §3);
 * the host preserves agent identity on the HTTP hop and `verifyAgentRequest`
 * has already cleared it before this tool runs. F7 will move the rest
 * of `tools/checkout.ts` to the same pattern.
 */

import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_RESOURCES } from "../apps/registry";
import { mapCheckoutToCartPreview, mapCheckoutToCartPreviewFull } from "../apps/cart-preview-mapper";
import { registerToolPair, pairedAppToolName } from "../apps/paired-tools";
import { wrapAsData } from "../apps/sanitize";
import { saleorQuery, getDefaultChannel } from "../saleor-client";
import {
	CHECKOUT_BY_ID_QUERY,
	CHECKOUT_LINES_UPDATE_MUTATION,
	CHECKOUT_LINES_DELETE_MUTATION,
	type CheckoutByIdData,
	type CheckoutLinesUpdateData,
	type CheckoutLinesDeleteData,
} from "@/lib/protocols/shared/checkout-queries";

const RESOURCE_URI = APP_RESOURCES.cartPreview.uri;
const KIND = "cart-preview";

/**
 * Validate `api_key` when supplied. Mirrors the contract in
 * `tools/checkout.ts`: empty `AGENT_API_KEYS` env = auth disabled
 * (development mode), otherwise the supplied key must appear in the set.
 *
 * Returns `null` when auth passes (or is bypassed); returns a tool
 * response payload when auth fails.
 */
function validateOptionalApiKey(apiKey: string | undefined): null | {
	content: [{ type: "text"; text: string }];
} {
	if (apiKey === undefined) return null;
	const keys = process.env.AGENT_API_KEYS || "";
	const validKeys = new Set(
		keys
			.split(",")
			.map((k) => k.trim())
			.filter(Boolean),
	);
	if (validKeys.size === 0) return null;
	if (validKeys.has(apiKey)) return null;
	return {
		content: [{ type: "text", text: JSON.stringify({ error: "Invalid or missing api_key" }) }],
	};
}

function notFoundResponse() {
	return { content: [{ type: "text" as const, text: "Cart not found" }] };
}

/** Shared zod fields — keeps the get_cart pair in lockstep. */
const getCartInput = {
	checkout_id: z.string().describe("Saleor checkout ID (cart ID)"),
	api_key: z
		.string()
		.optional()
		.describe(
			"Optional agent API key. Iframe calls omit it (host preserves identity); HTTP-transport agents may still pass it.",
		),
	channel: z.string().default(getDefaultChannel()).describe("Sales channel slug"),
};

export function registerCartPreviewTools(server: McpServer) {
	// ───────────────────────────────────────────────────────────────
	// get_cart  +  get_cart_full   (paired)
	// ───────────────────────────────────────────────────────────────
	registerToolPair(server, {
		resourceUri: RESOURCE_URI,
		model: {
			name: "get_cart",
			config: {
				title: "Get cart preview",
				description:
					"Get a preview of the cart for visual rendering. Returns lines, totals, and boolean status flags — no buyer email or address. Use `get_cart_full` (app-only) for the address-bearing payload.",
				inputSchema: getCartInput,
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
				if (!result.data.checkout) return notFoundResponse();

				const payload = mapCheckoutToCartPreview(result.data.checkout);
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
			name: pairedAppToolName("get_cart"),
			config: {
				title: "Get cart preview (full, app-only)",
				description:
					"App-only paired sibling of `get_cart`. Returns the same shape plus buyer email/phone and shipping/billing addresses. Iframe calls this through `bridge.fetchAppData('get_cart', {...})`.",
				inputSchema: getCartInput,
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
				if (!result.data.checkout) return notFoundResponse();

				const payload = mapCheckoutToCartPreviewFull(result.data.checkout);
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

	// ───────────────────────────────────────────────────────────────
	// update_cart_line   (standalone app-only)
	// ───────────────────────────────────────────────────────────────
	registerAppTool(
		server,
		"update_cart_line",
		{
			title: "Update cart line (app-only)",
			description:
				"Iframe-only tool: change the quantity of a single cart line. quantity=0 removes the line. Returns the refreshed cart preview payload (no PII). Not surfaced to the model — it's a UI affordance, not a reasoning step.",
			inputSchema: {
				checkout_id: z.string().describe("Saleor checkout ID"),
				line_id: z.string().describe("Cart line ID to update"),
				quantity: z
					.number()
					.int()
					.min(0)
					.describe("New quantity. Zero removes the line via checkoutLinesDelete."),
				api_key: z
					.string()
					.optional()
					.describe(
						"Optional agent API key. Iframe always omits — host preserves identity from the originating session.",
					),
			},
			_meta: {
				ui: { resourceUri: RESOURCE_URI, visibility: ["app"] as const },
			},
		},
		async ({ checkout_id, line_id, quantity, api_key }) => {
			const authFail = validateOptionalApiKey(api_key);
			if (authFail) return authFail;

			if (quantity === 0) {
				const r = await saleorQuery<CheckoutLinesDeleteData>(CHECKOUT_LINES_DELETE_MUTATION, {
					id: checkout_id,
					linesIds: [line_id],
				});
				if (!r.ok) {
					return { content: [{ type: "text" as const, text: `Error: ${r.error}` }] };
				}
				const updated = r.data.checkoutLinesDelete.checkout;
				if (!updated) return notFoundResponse();
				const payload = mapCheckoutToCartPreview(updated);
				return {
					content: [
						{
							type: "text" as const,
							text: wrapAsData(JSON.stringify(payload, null, 2), KIND),
						},
					],
				};
			}

			const r = await saleorQuery<CheckoutLinesUpdateData>(CHECKOUT_LINES_UPDATE_MUTATION, {
				id: checkout_id,
				lines: [{ lineId: line_id, quantity }],
			});
			if (!r.ok) {
				return { content: [{ type: "text" as const, text: `Error: ${r.error}` }] };
			}
			const updated = r.data.checkoutLinesUpdate.checkout;
			if (!updated) return notFoundResponse();
			const payload = mapCheckoutToCartPreview(updated);
			return {
				content: [
					{
						type: "text" as const,
						text: wrapAsData(JSON.stringify(payload, null, 2), KIND),
					},
				],
			};
		},
	);
}
