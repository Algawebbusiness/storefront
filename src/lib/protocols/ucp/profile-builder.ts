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
// Side-effect import: each payment handler self-registers with the registry.
import "../handlers";
import { buildPaymentHandlersForProfile } from "../shared/payment-handlers";
import { getPublicKeyBase64, getSigningKey } from "../shared/signing";
import {
	ALL_BUSINESS_CAPABILITIES,
	UCP_SCHEMA_BASE,
	UCP_SPEC_BASE,
	UCP_VERSION,
	type CapabilityDef,
} from "./capabilities";
import type { AcceptedPlatform, UcpCapability, UcpProfile, UcpRequestSigning, UcpSigningKey } from "./types";

/**
 * Published request-signing contract (B3). MUST match `verifySignedRequest`
 * in `shared/auth.ts` and `buildSigningString` in `shared/signing.ts`.
 */
const REQUEST_SIGNING: UcpRequestSigning = {
	algorithm: "ed25519",
	required_headers: ["UCP-Agent", "UCP-Signature", "UCP-Timestamp", "UCP-Nonce"],
	canonical_string: "{method}\n{path_and_query}\n{timestamp}\n{nonce}\n{body_sha256_hex}",
	canonical_string_fields: [
		"method (uppercase, e.g. POST)",
		"path_and_query (e.g. /api/ucp/rest/orders/abc?x=1)",
		"timestamp (the UCP-Timestamp header value)",
		"nonce (the UCP-Nonce header value)",
		"body_sha256_hex (lowercase hex SHA-256 of the raw body; hash the empty string for bodiless requests)",
	],
	signature_header_format: 'keyid="<kid>",alg="ed25519",sig="<base64(signature)>"',
	timestamp: "Unix epoch seconds; rejected if more than max_clock_skew_seconds from server time",
	nonce: "Unique per request (e.g. a random 128-bit hex). Replayed nonces are rejected.",
	body_hash: "SHA-256 of the raw request body, lowercase hex",
	max_clock_skew_seconds: 300,
};

/** Build the UCP business profile from environment configuration. */
export async function buildUcpProfile(): Promise<UcpProfile> {
	const baseUrl = process.env.NEXT_PUBLIC_STOREFRONT_URL || "http://localhost:3000";
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

			payment_handlers: buildPaymentHandlersForProfile(),
		},

		signing_keys: signingKeys,
		request_signing: REQUEST_SIGNING,
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
