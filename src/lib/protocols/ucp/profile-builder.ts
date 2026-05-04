/**
 * UCP business profile builder.
 *
 * Generates the /.well-known/ucp profile JSON based on deployment configuration.
 * This profile is the first thing any UCP-compatible agent reads to discover
 * what the business supports.
 *
 * Capability definitions live in `./capabilities.ts` so A4/A5 can extend the
 * advertised set without touching this builder.
 */

import { getPublicKeyBase64, getSigningKey } from "../shared/signing";
import {
	ALL_BUSINESS_CAPABILITIES,
	UCP_SCHEMA_BASE,
	UCP_SPEC_BASE,
	UCP_VERSION,
	type CapabilityDef,
} from "./capabilities";
import type { UcpCapability, UcpProfile, UcpSigningKey } from "./types";

/** Build the UCP business profile from environment configuration. */
export async function buildUcpProfile(): Promise<UcpProfile> {
	const baseUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL || "http://localhost:3000";
	const stripeKey = process.env.STRIPE_PUBLISHABLE_KEY;
	const signingKeys = await collectSigningKeys();

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

			capabilities: Object.fromEntries(
				ALL_BUSINESS_CAPABILITIES.map((cap) => [cap.id, [toUcpCapability(cap)]]),
			),

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

		signing_keys: signingKeys,
	};
}

function toUcpCapability(def: CapabilityDef): UcpCapability {
	return {
		version: UCP_VERSION,
		spec: `${UCP_SPEC_BASE}/${def.spec}`,
		schema: `${UCP_SCHEMA_BASE}/${def.schema}`,
		...(def.extends ? { extends: def.extends } : {}),
	};
}

async function collectSigningKeys(): Promise<UcpSigningKey[]> {
	const [{ keyId }, publicKey] = await Promise.all([getSigningKey(), getPublicKeyBase64()]);
	return [
		{
			kid: keyId,
			algorithm: "ed25519",
			public_key: publicKey,
		},
	];
}
