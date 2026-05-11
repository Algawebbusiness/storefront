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
import type { UcpCapability, UcpPaymentInstrument, UcpProfile, UcpSigningKey } from "./types";

/** Default set of payment instruments when no env override is provided. */
const DEFAULT_STRIPE_INSTRUMENTS: UcpPaymentInstrument[] = ["card"];

/** Build the UCP business profile from environment configuration. */
export async function buildUcpProfile(): Promise<UcpProfile> {
	const baseUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL || "http://localhost:3000";
	const stripeKey = process.env.STRIPE_PUBLISHABLE_KEY;
	const stripeInstruments = parseStripeInstruments();
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
						endpoint: `${baseUrl}/mcp`,
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
									available_payment_instruments: stripeInstruments,
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

/**
 * Parse `STRIPE_AVAILABLE_INSTRUMENTS` env var (comma-separated) into the typed
 * payment instrument list. Empty/missing → default `["card"]`. Whitespace and
 * empty entries are dropped; values are not validated against the closed enum
 * subset (the type is open by design — agents may need region-specific names).
 *
 * Phase A6 ships static config; A.E1 (control panel) may swap this for a
 * dynamic Stripe `paymentMethods.list` lookup.
 */
function parseStripeInstruments(): UcpPaymentInstrument[] {
	const raw = process.env.STRIPE_AVAILABLE_INSTRUMENTS;
	if (!raw) return DEFAULT_STRIPE_INSTRUMENTS;
	const parsed = raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
	return parsed.length > 0 ? (parsed as UcpPaymentInstrument[]) : DEFAULT_STRIPE_INSTRUMENTS;
}
