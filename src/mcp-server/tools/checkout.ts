/**
 * MCP checkout tools for AI agent purchasing via the UCP protocol.
 *
 * These are authenticated tools — agents pass an api_key parameter
 * (since MCP transport has no HTTP headers).
 */

import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { saleorQuery, getDefaultChannel } from "../saleor-client.js";
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
} from "@/lib/protocols/shared/checkout-queries.js";
import { mapCheckoutToProtocol } from "@/lib/protocols/shared/checkout-mapper.js";
import { processStripePayment } from "@/lib/protocols/shared/payment.js";

/** Validate api_key against AGENT_API_KEYS env var */
function validateApiKey(apiKey: string): boolean {
	const keys = process.env.AGENT_API_KEYS || "";
	const validKeys = new Set(
		keys
			.split(",")
			.map((k) => k.trim())
			.filter(Boolean),
	);

	// No keys configured = auth disabled (development mode)
	if (validKeys.size === 0) {
		return true;
	}

	return validKeys.has(apiKey);
}

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
	// create_checkout
	// ---------------------------------------------------------------
	server.tool(
		"create_checkout",
		"Create a new checkout session with line items for AI agent purchasing. Requires api_key.",
		{
			api_key: z.string().describe("Agent API key for authentication"),
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

			return {
				content: [{ type: "text" as const, text: JSON.stringify(mapCheckoutToProtocol(checkout), null, 2) }],
			};
		},
	);

	// ---------------------------------------------------------------
	// get_checkout
	// ---------------------------------------------------------------
	server.tool(
		"get_checkout",
		"Get the current state of a checkout session. Requires api_key.",
		{
			api_key: z.string().describe("Agent API key for authentication"),
			checkout_id: z.string().describe("Saleor checkout ID"),
		},
		async ({ api_key, checkout_id }) => {
			if (!validateApiKey(api_key)) {
				return authError();
			}

			const result = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, {
				id: checkout_id,
			});

			if (!result.ok) {
				return { content: [{ type: "text" as const, text: `Error: ${result.error}` }] };
			}

			if (!result.data.checkout) {
				return { content: [{ type: "text" as const, text: "Checkout not found" }] };
			}

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(mapCheckoutToProtocol(result.data.checkout), null, 2),
					},
				],
			};
		},
	);

	// ---------------------------------------------------------------
	// update_checkout
	// ---------------------------------------------------------------
	server.tool(
		"update_checkout",
		"Update a checkout session (email, addresses, shipping method, promo code). Requires api_key.",
		{
			api_key: z.string().describe("Agent API key for authentication"),
			checkout_id: z.string().describe("Saleor checkout ID"),
			email: z.string().email().optional().describe("Update customer email"),
			shipping_address: addressSchema.optional().describe("Update shipping address"),
			billing_address: addressSchema.optional().describe("Update billing address"),
			delivery_method_id: z.string().optional().describe("Shipping/delivery method ID"),
			promo_code: z.string().optional().describe("Promo/voucher code to apply"),
		},
		async ({ api_key, checkout_id, email, shipping_address, billing_address, delivery_method_id, promo_code }) => {
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
					allErrors.push(
						...r.data.checkoutEmailUpdate.errors.map((e) => `Email: ${e.message}`),
					);
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
					allErrors.push(
						...r.data.checkoutAddPromoCode.errors.map((e) => `Promo code: ${e.message}`),
					);
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

			const mapped = mapCheckoutToProtocol(result.data.checkout);
			const response = allErrors.length > 0 ? { ...mapped, warnings: allErrors } : mapped;

			return {
				content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
			};
		},
	);

	// ---------------------------------------------------------------
	// complete_checkout
	// ---------------------------------------------------------------
	server.tool(
		"complete_checkout",
		"Complete a checkout with payment. Processes Stripe payment token, then finalizes the order. Requires api_key.",
		{
			api_key: z.string().describe("Agent API key for authentication"),
			checkout_id: z.string().describe("Saleor checkout ID"),
			payment_token: z.string().describe("Stripe shared payment token"),
			payment_gateway_id: z
				.string()
				.optional()
				.describe("Payment gateway ID (defaults to STRIPE_GATEWAY_ID or 'app.saleor.stripe')"),
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
							text: JSON.stringify(
								{ error: `Payment failed: ${paymentResult.error}` },
								null,
								2,
							),
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

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								order_id: order.id,
								order_number: order.number,
								status: order.status,
								transaction_id: paymentResult.transactionId,
							},
							null,
							2,
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
