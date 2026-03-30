/**
 * UCP business profile builder.
 *
 * Generates the /.well-known/ucp profile JSON based on deployment configuration.
 * This profile is the first thing any UCP-compatible agent reads to discover
 * what the business supports.
 */

import type { UcpProfile } from "./types";

const UCP_VERSION = process.env.UCP_VERSION || "2026-01-23";
const UCP_SPEC_BASE = `https://ucp.dev/${UCP_VERSION}/specification`;
const UCP_SCHEMA_BASE = `https://ucp.dev/${UCP_VERSION}`;

/** Build the UCP business profile from environment configuration */
export function buildUcpProfile(): UcpProfile {
	const baseUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL || "http://localhost:3000";
	const stripeKey = process.env.STRIPE_PUBLISHABLE_KEY;

	return {
		ucp: {
			version: UCP_VERSION,

			services: {
				"dev.ucp.shopping": [
					{
						version: UCP_VERSION,
						spec: `${UCP_SPEC_BASE}/overview`,
						transport: "rest",
						endpoint: `${baseUrl}/api/ucp/rest`,
						schema: `${UCP_SCHEMA_BASE}/services/shopping/openapi.json`,
					},
					{
						version: UCP_VERSION,
						spec: `${UCP_SPEC_BASE}/overview`,
						transport: "mcp",
						endpoint: `${baseUrl}/api/ucp/mcp`,
						schema: `${UCP_SCHEMA_BASE}/services/shopping/openrpc.json`,
					},
				],
			},

			capabilities: {
				"dev.ucp.shopping.checkout": [
					{
						version: UCP_VERSION,
						spec: `${UCP_SPEC_BASE}/checkout`,
						schema: `${UCP_SCHEMA_BASE}/schemas/shopping/checkout.json`,
					},
				],
				"dev.ucp.shopping.fulfillment": [
					{
						version: UCP_VERSION,
						spec: `${UCP_SPEC_BASE}/fulfillment`,
						schema: `${UCP_SCHEMA_BASE}/schemas/shopping/fulfillment.json`,
						extends: "dev.ucp.shopping.checkout",
					},
				],
				"dev.ucp.shopping.discount": [
					{
						version: UCP_VERSION,
						spec: `${UCP_SPEC_BASE}/discount`,
						schema: `${UCP_SCHEMA_BASE}/schemas/shopping/discount.json`,
						extends: "dev.ucp.shopping.checkout",
					},
				],
			},

			payment_handlers: stripeKey
				? {
						"com.stripe.shared_payment_token": [
							{
								id: "stripe_spt",
								version: UCP_VERSION,
								config: {
									publishable_key: stripeKey,
								},
							},
						],
					}
				: {},
		},

		signing_keys: [],
	};
}
