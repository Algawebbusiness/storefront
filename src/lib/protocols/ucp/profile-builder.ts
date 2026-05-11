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

import { listActiveAgents } from "../shared/agent-registry";
import type { AgentIdentity } from "../shared/agent-registry-types";
import { getPublicKeyBase64, getSigningKey } from "../shared/signing";
import {
	ALL_BUSINESS_CAPABILITIES,
	UCP_SCHEMA_BASE,
	UCP_SPEC_BASE,
	UCP_VERSION,
	type CapabilityDef,
} from "./capabilities";
import type {
	AcceptedPlatform,
	UcpCapability,
	UcpPaymentInstrument,
	UcpProfile,
	UcpSigningKey,
} from "./types";

/** Default set of payment instruments when no env override is provided. */
const DEFAULT_STRIPE_INSTRUMENTS: UcpPaymentInstrument[] = ["card"];

/** Build the UCP business profile from environment configuration. */
export async function buildUcpProfile(): Promise<UcpProfile> {
	const baseUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL || "http://localhost:3000";
	const stripeKey = process.env.STRIPE_PUBLISHABLE_KEY;
	const stripeInstruments = parseStripeInstruments();
	const [signingKeys, acceptedPlatforms] = await Promise.all([
		collectSigningKeys(),
		collectAcceptedPlatforms(),
	]);

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
		...(acceptedPlatforms.length > 0 ? { accepted_platforms: acceptedPlatforms } : {}),
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
 * Phase B8: derive `accepted_platforms[]` from the active agent registry.
 *
 * Group agents by platform, drop `custom` (used internally only — agents
 * outside the four named platforms aren't a "trusted public discovery"
 * signal), surface every agent's public_key for that platform.
 *
 * Returns an empty array when no agents are registered — the profile then
 * omits the `accepted_platforms` field entirely.
 */
async function collectAcceptedPlatforms(): Promise<AcceptedPlatform[]> {
	let agents: AgentIdentity[];
	try {
		agents = await listActiveAgents();
	} catch {
		return [];
	}
	if (agents.length === 0) return [];

	const grouped = new Map<AcceptedPlatform["platform"], string[]>();
	for (const agent of agents) {
		if (agent.platform === "custom") continue;
		if (!agent.public_key) continue; // legacy synthetic / unkeyed agents excluded
		const existing = grouped.get(agent.platform) ?? [];
		if (!existing.includes(agent.public_key)) existing.push(agent.public_key);
		grouped.set(agent.platform, existing);
	}

	const out: AcceptedPlatform[] = [];
	for (const [platform, public_keys] of grouped.entries()) {
		out.push({
			platform,
			display_name: PLATFORM_DISPLAY[platform],
			trust_level: "verified",
			public_keys,
		});
	}
	return out;
}

const PLATFORM_DISPLAY: Record<AcceptedPlatform["platform"], string> = {
	openai: "OpenAI (ChatGPT)",
	google: "Google (Gemini)",
	anthropic: "Anthropic (Claude)",
	microsoft: "Microsoft (Copilot)",
};

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
