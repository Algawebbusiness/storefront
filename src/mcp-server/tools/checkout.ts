/**
 * MCP checkout tools for AI agent purchasing via the UCP protocol.
 *
 * These are authenticated tools — agents pass an api_key parameter
 * (since MCP transport has no HTTP headers).
 */

import { registerAppTool } from "../apps/feature-flag";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_RESOURCES } from "../apps/registry";
import { mapCheckoutToCartPreview } from "../apps/cart-preview-mapper";
import { mapCheckoutToCheckoutSummary } from "../apps/checkout-summary-mapper";
import { mapOrderToOrderReceipt } from "../apps/order-receipt-mapper";
import { wrapAsData } from "../apps/sanitize";
import { saleorQuery, getDefaultChannel } from "../saleor-client";
import {
	CHECKOUT_CREATE_MUTATION,
	CHECKOUT_BY_ID_QUERY,
	CHECKOUT_EMAIL_UPDATE_MUTATION,
	CHECKOUT_SHIPPING_ADDRESS_UPDATE_MUTATION,
	CHECKOUT_BILLING_ADDRESS_UPDATE_MUTATION,
	CHECKOUT_DELIVERY_METHOD_UPDATE_MUTATION,
	CHECKOUT_ADD_PROMO_CODE_MUTATION,
	CHECKOUT_COMPLETE_MUTATION,
	type CheckoutCreateData,
	type CheckoutByIdData,
	type CheckoutEmailUpdateData,
	type CheckoutShippingAddressUpdateData,
	type CheckoutBillingAddressUpdateData,
	type CheckoutDeliveryMethodUpdateData,
	type CheckoutAddPromoCodeData,
	type CheckoutCompleteData,
} from "@/lib/protocols/shared/checkout-queries";
import { ORDER_BY_ID_QUERY, type OrderByIdData } from "@/lib/protocols/shared/order-queries";
import { processStripePayment } from "@/lib/protocols/shared/payment";
import { isMcpApiKeyAuthorized } from "./api-key-auth";

/**
 * Validate api_key for checkout tools. Delegates to the shared, fail-closed
 * `isMcpApiKeyAuthorized` (the old "undefined ⇒ trust transport" default is now
 * honored only in dev/test or with `MCP_TRUST_TRANSPORT=true`, since `/mcp` is
 * a public transport — see `api-key-auth.ts`).
 */
const validateApiKey = isMcpApiKeyAuthorized;

function authError() {
	return {
		content: [{ type: "text" as const, text: JSON.stringify({ error: "Invalid or missing api_key" }) }],
	};
}

/** Zod schema for an address input */
const addressSchema = z.object({
	firstName: z.string().optional(),
	lastName: z.string().optional(),
	companyName: z.string().optional(),
	streetAddress1: z.string(),
	streetAddress2: z.string().optional(),
	city: z.string(),
	cityArea: z.string().optional(),
	postalCode: z.string(),
	country: z.string().describe("ISO 3166-1 alpha-2 country code (e.g. CZ, US)"),
	countryArea: z.string().optional(),
	phone: z.string().optional(),
});

export function registerCheckoutTools(server: McpServer) {
	// ---------------------------------------------------------------
	// create_checkout — wired to ui://saleor/cart-preview.html (F6).
	//
	// Response is now `CartPreviewPayload` (model-visible only — no PII,
	// per threat-model §2), wrapped by `wrapAsData(..., "cart-preview")`
	// for indirect-prompt-injection defense. Agents that need the full
	// protocol shape (`ProtocolCheckout` with addresses) should call the
	// paired `get_cart_full` from `cart-preview.ts` via the iframe, or
	// fall back to the UCP REST `/api/ucp/rest/checkout-sessions` route
	// which still returns the full payload.
	//
	// `api_key` is optional: iframe-relayed callers omit it (host has
	// preserved agent identity on the transport hop); HTTP-direct agents
	// may still supply it for env-AGENT_API_KEYS validation.
	// ---------------------------------------------------------------
	registerAppTool(
		server,
		"create_checkout",
		{
			title: "Create checkout",
			description:
				"Create a new checkout session with line items. Returns a cart-preview payload (lines, totals, status flags) — addresses/buyer surfaced only via the paired `get_cart_full` (app-only).",
			inputSchema: {
				api_key: z
					.string()
					.optional()
					.describe("Optional agent API key. Iframe-relayed callers omit it; HTTP agents may still pass it."),
				line_items: z
					.array(
						z.object({
							variant_id: z.string().describe("Saleor product variant ID"),
							quantity: z.number().int().positive(),
						}),
					)
					.min(1)
					.describe("Items to add to the checkout"),
				email: z.string().email().optional().describe("Customer email"),
				channel: z.string().default(getDefaultChannel()).describe("Sales channel slug"),
			},
			_meta: {
				ui: { resourceUri: APP_RESOURCES.cartPreview.uri },
			},
		},
		async ({ api_key, line_items, email, channel }) => {
			if (!validateApiKey(api_key)) {
				return authError();
			}

			// Create checkout with lines
			const createResult = await saleorQuery<CheckoutCreateData>(CHECKOUT_CREATE_MUTATION, {
				input: {
					channel,
					lines: line_items.map((li) => ({
						variantId: li.variant_id,
						quantity: li.quantity,
					})),
					...(email && { email }),
				},
			});

			if (!createResult.ok) {
				return { content: [{ type: "text" as const, text: `Error: ${createResult.error}` }] };
			}

			const { checkout, errors } = createResult.data.checkoutCreate;

			if (errors.length > 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({ errors: errors.map((e) => e.message) }, null, 2),
						},
					],
				};
			}

			if (!checkout) {
				return { content: [{ type: "text" as const, text: "Error: No checkout returned" }] };
			}

			const payload = mapCheckoutToCartPreview(checkout);
			return {
				content: [
					{
						type: "text" as const,
						text: wrapAsData(JSON.stringify(payload, null, 2), "cart-preview"),
					},
				],
			};
		},
	);

	// ---------------------------------------------------------------
	// update_checkout — app-only mutator, wired to checkout-summary view (F7).
	//
	// Visibility `["app"]` — not in `tools/list`, callable only from the
	// iframe (`bridge.callTool("update_checkout", {...})`) or from a host
	// LLM that already knows it exists. Response is the model-visible
	// `CheckoutSummaryPayload`; the iframe re-fetches the full payload
	// (with addresses) via `bridge.fetchAppData("get_checkout", ...)`.
	// ---------------------------------------------------------------
	registerAppTool(
		server,
		"update_checkout",
		{
			title: "Update checkout (app-only)",
			description:
				"Update a checkout session (email, addresses, shipping method, promo code). Returns the refreshed checkout-summary payload (no PII).",
			inputSchema: {
				api_key: z
					.string()
					.optional()
					.describe("Optional agent API key (iframe omits; HTTP agents may pass)."),
				checkout_id: z.string().describe("Saleor checkout ID"),
				email: z.string().email().optional().describe("Update customer email"),
				shipping_address: addressSchema.optional().describe("Update shipping address"),
				billing_address: addressSchema.optional().describe("Update billing address"),
				delivery_method_id: z.string().optional().describe("Shipping/delivery method ID"),
				promo_code: z.string().optional().describe("Promo/voucher code to apply"),
			},
			_meta: {
				ui: { resourceUri: APP_RESOURCES.checkoutSummary.uri, visibility: ["app"] as const },
			},
		},
		async ({
			api_key,
			checkout_id,
			email,
			shipping_address,
			billing_address,
			delivery_method_id,
			promo_code,
		}) => {
			if (!validateApiKey(api_key)) {
				return authError();
			}

			// Apply each update sequentially (order matters: address before delivery method)
			const allErrors: string[] = [];

			if (email) {
				const r = await saleorQuery<CheckoutEmailUpdateData>(CHECKOUT_EMAIL_UPDATE_MUTATION, {
					id: checkout_id,
					email,
				});
				if (!r.ok) {
					allErrors.push(`Email update failed: ${r.error}`);
				} else if (r.data.checkoutEmailUpdate.errors.length > 0) {
					allErrors.push(...r.data.checkoutEmailUpdate.errors.map((e) => `Email: ${e.message}`));
				}
			}

			if (shipping_address) {
				const r = await saleorQuery<CheckoutShippingAddressUpdateData>(
					CHECKOUT_SHIPPING_ADDRESS_UPDATE_MUTATION,
					{ id: checkout_id, shippingAddress: shipping_address },
				);
				if (!r.ok) {
					allErrors.push(`Shipping address update failed: ${r.error}`);
				} else if (r.data.checkoutShippingAddressUpdate.errors.length > 0) {
					allErrors.push(
						...r.data.checkoutShippingAddressUpdate.errors.map((e) => `Shipping address: ${e.message}`),
					);
				}
			}

			if (billing_address) {
				const r = await saleorQuery<CheckoutBillingAddressUpdateData>(
					CHECKOUT_BILLING_ADDRESS_UPDATE_MUTATION,
					{ id: checkout_id, billingAddress: billing_address },
				);
				if (!r.ok) {
					allErrors.push(`Billing address update failed: ${r.error}`);
				} else if (r.data.checkoutBillingAddressUpdate.errors.length > 0) {
					allErrors.push(
						...r.data.checkoutBillingAddressUpdate.errors.map((e) => `Billing address: ${e.message}`),
					);
				}
			}

			if (delivery_method_id) {
				const r = await saleorQuery<CheckoutDeliveryMethodUpdateData>(
					CHECKOUT_DELIVERY_METHOD_UPDATE_MUTATION,
					{ id: checkout_id, deliveryMethodId: delivery_method_id },
				);
				if (!r.ok) {
					allErrors.push(`Delivery method update failed: ${r.error}`);
				} else if (r.data.checkoutDeliveryMethodUpdate.errors.length > 0) {
					allErrors.push(
						...r.data.checkoutDeliveryMethodUpdate.errors.map((e) => `Delivery method: ${e.message}`),
					);
				}
			}

			if (promo_code) {
				const r = await saleorQuery<CheckoutAddPromoCodeData>(CHECKOUT_ADD_PROMO_CODE_MUTATION, {
					checkoutId: checkout_id,
					promoCode: promo_code,
				});
				if (!r.ok) {
					allErrors.push(`Promo code failed: ${r.error}`);
				} else if (r.data.checkoutAddPromoCode.errors.length > 0) {
					allErrors.push(...r.data.checkoutAddPromoCode.errors.map((e) => `Promo code: ${e.message}`));
				}
			}

			// Fetch updated checkout state
			const result = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, {
				id: checkout_id,
			});

			if (!result.ok) {
				return { content: [{ type: "text" as const, text: `Error fetching checkout: ${result.error}` }] };
			}

			if (!result.data.checkout) {
				return { content: [{ type: "text" as const, text: "Checkout not found" }] };
			}

			const summary = mapCheckoutToCheckoutSummary(result.data.checkout);
			const payload =
				allErrors.length > 0
					? {
							...summary,
							warnings: [
								...(summary.warnings ?? []),
								...allErrors.map((message) => ({ code: "update_partial", message })),
							],
						}
					: summary;

			return {
				content: [
					{
						type: "text" as const,
						text: wrapAsData(JSON.stringify(payload, null, 2), "checkout-summary"),
					},
				],
			};
		},
	);

	// ---------------------------------------------------------------
	// complete_checkout — app-only finaliser, wired to order-receipt view (F7).
	//
	// Visibility `["app"]` per threat-model §4: payment-token-bearing
	// tool calls should never leak into `tools/list`. Response is the
	// model-visible `OrderReceiptPayload` (7 fields) wrapped by
	// `wrapAsData(..., "order-receipt")`; the iframe pulls the full
	// payload (lines, totals, addresses, buyer email) via
	// `bridge.fetchAppData("get_order", {order_id})`.
	// ---------------------------------------------------------------
	registerAppTool(
		server,
		"complete_checkout",
		{
			title: "Complete checkout (app-only)",
			description:
				"Complete a checkout with a Stripe payment token. Returns the model-visible order receipt payload; iframe pulls full details (lines, addresses) via `get_order_full`.",
			inputSchema: {
				api_key: z
					.string()
					.optional()
					.describe("Optional agent API key (iframe omits; HTTP agents may pass)."),
				checkout_id: z.string().describe("Saleor checkout ID"),
				payment_token: z.string().describe("Stripe shared payment token (one-time)"),
				payment_gateway_id: z
					.string()
					.optional()
					.describe("Payment gateway ID (defaults to STRIPE_GATEWAY_ID or 'app.saleor.stripe')"),
			},
			_meta: {
				ui: { resourceUri: APP_RESOURCES.orderReceipt.uri, visibility: ["app"] as const },
			},
		},
		async ({ api_key, checkout_id, payment_token, payment_gateway_id: _payment_gateway_id }) => {
			if (!validateApiKey(api_key)) {
				return authError();
			}

			// Step 1: Process payment
			const paymentResult = await processStripePayment(checkout_id, payment_token);

			if (!paymentResult.ok) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify({ error: `Payment failed: ${paymentResult.error}` }, null, 2),
						},
					],
				};
			}

			// Step 2: Complete the checkout
			const completeResult = await saleorQuery<CheckoutCompleteData>(CHECKOUT_COMPLETE_MUTATION, {
				checkoutId: checkout_id,
			});

			if (!completeResult.ok) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									error: `Checkout completion failed: ${completeResult.error}`,
									payment_status: paymentResult.status,
									transaction_id: paymentResult.transactionId,
								},
								null,
								2,
							),
						},
					],
				};
			}

			const { order, errors } = completeResult.data.checkoutComplete;

			if (errors.length > 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									error: "Checkout completion errors",
									details: errors.map((e) => e.message),
									payment_status: paymentResult.status,
									transaction_id: paymentResult.transactionId,
								},
								null,
								2,
							),
						},
					],
				};
			}

			if (!order) {
				return {
					content: [
						{
							type: "text" as const,
							text: JSON.stringify(
								{
									error: "No order returned after completion",
									payment_status: paymentResult.status,
									transaction_id: paymentResult.transactionId,
								},
								null,
								2,
							),
						},
					],
				};
			}

			// Step 3: Fetch the freshly-created order so we can render a
			// real receipt. `checkoutComplete` only echoes back {id, number,
			// status} — not enough for `OrderReceiptPayload`'s 7 fields.
			const orderResult = await saleorQuery<OrderByIdData>(ORDER_BY_ID_QUERY, { id: order.id });
			if (orderResult.ok && orderResult.data.order) {
				const payload = mapOrderToOrderReceipt(orderResult.data.order);
				return {
					content: [
						{
							type: "text" as const,
							text: wrapAsData(JSON.stringify(payload, null, 2), "order-receipt"),
						},
					],
				};
			}

			// Fallback: order fetch failed; ship the minimal mutation echo.
			return {
				content: [
					{
						type: "text" as const,
						text: wrapAsData(
							JSON.stringify(
								{
									id: order.id,
									number: order.number,
									status: order.status,
									statusDisplay: order.status,
									currency: "",
									total: 0,
									isPaid: false,
								},
								null,
								2,
							),
							"order-receipt",
						),
					},
				],
			};
		},
	);

	// ---------------------------------------------------------------
	// cancel_checkout
	// ---------------------------------------------------------------
	server.tool(
		"cancel_checkout",
		"Cancel a checkout session. Saleor has no native cancel — this returns a cancelled status. Requires api_key.",
		{
			api_key: z.string().describe("Agent API key for authentication"),
			checkout_id: z.string().describe("Saleor checkout ID"),
		},
		async ({ api_key, checkout_id }) => {
			if (!validateApiKey(api_key)) {
				return authError();
			}

			// Saleor doesn't have a native checkout cancel mutation.
			// Checkouts auto-expire. We return cancelled status for protocol compliance.
			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								id: checkout_id,
								status: "cancelled",
								message: "Checkout marked as cancelled. It will auto-expire in Saleor.",
							},
							null,
							2,
						),
					},
				],
			};
		},
	);
}
