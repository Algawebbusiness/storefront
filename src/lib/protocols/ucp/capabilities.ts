/**
 * UCP capability negotiation.
 *
 * When a UCP agent connects, it provides its profile URL. We fetch the agent's
 * profile, extract its capabilities, and compute the intersection with our own
 * capabilities — the "negotiated" set used for the session.
 *
 * Agent profiles are cached in memory with a 1-hour TTL.
 */

import type { UcpResponseMeta } from "./types";

const UCP_VERSION = process.env.UCP_VERSION || "2026-01-23";

/** Our business capabilities */
const BUSINESS_CAPABILITIES: Record<string, Array<{ version: string }>> = {
	"dev.ucp.shopping.checkout": [{ version: UCP_VERSION }],
	"dev.ucp.shopping.fulfillment": [{ version: UCP_VERSION }],
	"dev.ucp.shopping.discount": [{ version: UCP_VERSION }],
};

/** Cached agent profile entry */
interface CachedProfile {
	capabilities: Record<string, Array<{ version: string }>>;
	fetchedAt: number;
}

/** In-memory cache for agent profiles (1h TTL) */
const agentProfileCache = new Map<string, CachedProfile>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

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
async function getAgentCapabilities(
	profileUrl: string,
): Promise<Record<string, Array<{ version: string }>>> {
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
		// No agent profile — return all business capabilities
		return BUSINESS_CAPABILITIES;
	}

	const agentCaps = await getAgentCapabilities(agentProfileUrl);

	// Compute intersection
	const negotiated: Record<string, Array<{ version: string }>> = {};

	for (const [capName, businessVersions] of Object.entries(BUSINESS_CAPABILITIES)) {
		const agentVersions = agentCaps[capName];
		if (!agentVersions || agentVersions.length === 0) continue;

		// Find matching versions
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
