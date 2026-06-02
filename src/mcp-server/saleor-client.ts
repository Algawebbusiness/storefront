/**
 * Lightweight Saleor GraphQL client for MCP server tools.
 *
 * Uses raw fetch instead of the main executePublicGraphQL to keep
 * MCP tool responses lean and avoid pulling in heavy generated types.
 */

const SALEOR_API_URL = process.env.NEXT_PUBLIC_SALEOR_API_URL;
const DEFAULT_CHANNEL = process.env.NEXT_PUBLIC_DEFAULT_CHANNEL || "default-channel";

export function getDefaultChannel(): string {
	return DEFAULT_CHANNEL;
}

export async function saleorQuery<T = unknown>(
	query: string,
	variables: Record<string, unknown> = {},
	opts: {
		/**
		 * When set, sent as `Authorization: Bearer <authToken>` so Saleor
		 * authorizes the query as that principal (e.g. a customer's own token).
		 * Omit for anonymous/public reads. Used by ownership-scoped routes.
		 */
		authToken?: string;
	} = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
	if (!SALEOR_API_URL) {
		return { ok: false, error: "NEXT_PUBLIC_SALEOR_API_URL is not configured" };
	}

	try {
		const res = await fetch(SALEOR_API_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(opts.authToken ? { Authorization: `Bearer ${opts.authToken}` } : {}),
			},
			body: JSON.stringify({ query, variables }),
		});

		if (!res.ok) {
			return { ok: false, error: `Saleor API returned HTTP ${res.status}` };
		}

		const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };

		if (json.errors && json.errors.length > 0) {
			return { ok: false, error: json.errors.map((e) => e.message).join("; ") };
		}

		if (!json.data) {
			return { ok: false, error: "No data returned from Saleor API" };
		}

		return { ok: true, data: json.data };
	} catch (err) {
		// Log details server-side; return a generic message so internal hostnames
		// / network errors don't leak deployment topology to callers (CWE-209).
		console.error("[saleor-client] request failed:", err);
		return { ok: false, error: "Upstream request failed" };
	}
}
