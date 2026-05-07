/**
 * UCP capability definitions and capability negotiation.
 *
 * Capability definitions are enumerated objects (not bare strings) so that A4/A5
 * can extend the set with `dev.ucp.shopping.cart` / `.catalog` by adding entries
 * to ALL_BUSINESS_CAPABILITIES. Both `profile-builder.ts` and the negotiation
 * helpers below read from the same source of truth.
 *
 * When a UCP agent connects, it provides its profile URL. We fetch the agent's
 * profile, extract its capabilities, and compute the intersection with our own
 * — the "negotiated" set used for the session. Agent profiles are cached in
 * memory with a 1-hour TTL.
 */

import type { UcpResponseMeta } from "./types";

/** Default UCP spec version. Override via UCP_VERSION env var. */
export const UCP_VERSION = process.env.UCP_VERSION || "2026-04-08";

/** Base URL for the UCP specification documents. */
export const UCP_SPEC_BASE = `https://ucp.dev/${UCP_VERSION}/specification`;

/** Base URL for the UCP JSON schemas. */
export const UCP_SCHEMA_BASE = `https://ucp.dev/${UCP_VERSION}`;

/**
 * Static description of a UCP capability supported by this storefront.
 *
 * `spec` and `schema` are URL fragments appended to UCP_SPEC_BASE / UCP_SCHEMA_BASE
 * — they intentionally don't include the version, so a single bump of UCP_VERSION
 * propagates to every capability.
 */
export interface CapabilityDef {
	id: string;
	spec: string;
	schema: string;
	extends?: string;
}

export const SHOPPING_CHECKOUT: CapabilityDef = {
	id: "dev.ucp.shopping.checkout",
	spec: "checkout",
	schema: "schemas/shopping/checkout.json",
};

export const SHOPPING_FULFILLMENT: CapabilityDef = {
	id: "dev.ucp.shopping.fulfillment",
	spec: "fulfillment",
	schema: "schemas/shopping/fulfillment.json",
	extends: SHOPPING_CHECKOUT.id,
};

export const SHOPPING_DISCOUNT: CapabilityDef = {
	id: "dev.ucp.shopping.discount",
	spec: "discount",
	schema: "schemas/shopping/discount.json",
	extends: SHOPPING_CHECKOUT.id,
};

/**
 * Cart capability — agent-built shopping cart prior to `checkout-session/complete`.
 * Maps onto Saleor `Checkout` in the pre-complete state. Added in Phase A4.
 */
export const SHOPPING_CART: CapabilityDef = {
	id: "dev.ucp.shopping.cart",
	spec: "cart",
	schema: "schemas/shopping/cart.json",
};

/**
 * Catalog capability — agent-facing product search, detail and category listing.
 * Coexists with the MCP `search_products` tool (REST + MCP transports advertised
 * side by side in the profile). Added in Phase A5.
 */
export const SHOPPING_CATALOG: CapabilityDef = {
	id: "dev.ucp.shopping.catalog",
	spec: "catalog",
	schema: "schemas/shopping/catalog.json",
};

/** All capabilities advertised in /.well-known/ucp. */
export const ALL_BUSINESS_CAPABILITIES: readonly CapabilityDef[] = [
	SHOPPING_CHECKOUT,
	SHOPPING_FULFILLMENT,
	SHOPPING_DISCOUNT,
	SHOPPING_CART,
	SHOPPING_CATALOG,
];

/** Map of capability ID → versions, derived from ALL_BUSINESS_CAPABILITIES. */
const BUSINESS_CAPABILITIES: Record<string, Array<{ version: string }>> = Object.fromEntries(
	ALL_BUSINESS_CAPABILITIES.map((c) => [c.id, [{ version: UCP_VERSION }]]),
);

/** Cached agent profile entry */
interface CachedProfile {
	capabilities: Record<string, Array<{ version: string }>>;
	fetchedAt: number;
}

/** In-memory cache for agent profiles (1h TTL) */
const agentProfileCache = new Map<string, CachedProfile>();
const CACHE_TTL_MS = 60 * 60 * 1000;

/** Fetch an agent's UCP profile and extract capabilities */
async function fetchAgentCapabilities(
	profileUrl: string,
): Promise<Record<string, Array<{ version: string }>>> {
	try {
		const res = await fetch(profileUrl, {
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(5000),
		});

		if (!res.ok) {
			return {};
		}

		const profile = (await res.json()) as {
			ucp?: { capabilities?: Record<string, Array<{ version: string }>> };
		};

		return profile.ucp?.capabilities ?? {};
	} catch {
		return {};
	}
}

/** Get agent capabilities, using cache if available */
async function getAgentCapabilities(profileUrl: string): Promise<Record<string, Array<{ version: string }>>> {
	const cached = agentProfileCache.get(profileUrl);

	if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
		return cached.capabilities;
	}

	const capabilities = await fetchAgentCapabilities(profileUrl);

	agentProfileCache.set(profileUrl, {
		capabilities,
		fetchedAt: Date.now(),
	});

	return capabilities;
}

/**
 * Negotiate capabilities between agent and business.
 *
 * Returns the intersection of capabilities supported by both sides.
 * If no agent profile URL is provided, returns all business capabilities.
 */
export async function negotiateCapabilities(
	agentProfileUrl?: string,
): Promise<Record<string, Array<{ version: string }>>> {
	if (!agentProfileUrl) {
		return BUSINESS_CAPABILITIES;
	}

	const agentCaps = await getAgentCapabilities(agentProfileUrl);

	const negotiated: Record<string, Array<{ version: string }>> = {};

	for (const [capName, businessVersions] of Object.entries(BUSINESS_CAPABILITIES)) {
		const agentVersions = agentCaps[capName];
		if (!agentVersions || agentVersions.length === 0) continue;

		const agentVersionSet = new Set(agentVersions.map((v) => v.version));
		const matchedVersions = businessVersions.filter((v) => agentVersionSet.has(v.version));

		if (matchedVersions.length > 0) {
			negotiated[capName] = matchedVersions;
		}
	}

	// If intersection is empty, fall back to business capabilities
	// (the agent might not declare capabilities, indicating it accepts all)
	if (Object.keys(negotiated).length === 0) {
		return BUSINESS_CAPABILITIES;
	}

	return negotiated;
}

/** Build the UCP response metadata wrapper */
export async function buildUcpMeta(agentProfileUrl?: string): Promise<UcpResponseMeta> {
	const capabilities = await negotiateCapabilities(agentProfileUrl);

	return {
		version: UCP_VERSION,
		capabilities,
	};
}
