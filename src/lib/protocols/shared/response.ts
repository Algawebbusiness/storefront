/**
 * Signed JSON response helpers for UCP/ACP endpoints (Phase A3).
 *
 * Every response from `/api/ucp/rest/*` (and ACP for consistency) carries a
 * `UCP-Signature` header so agents can verify authenticity against the public
 * key published in `/.well-known/ucp`.
 *
 * Header format (RFC 9421-inspired since the UCP 2026-04-08 spec doesn't
 * pin a wire format):
 *
 *   UCP-Signature: keyid="<kid>",alg="ed25519",sig="<base64>"
 *
 * Do NOT use these helpers for cacheable public responses (sitemap, llms.txt,
 * `/.well-known/ucp` itself). Sign only agent-facing endpoints.
 */

import { getSigningKey, signPayload } from "./signing";

/** Header name used to carry the response signature. */
export const SIGNATURE_HEADER = "UCP-Signature";

/**
 * Serialize `data` as JSON, sign the body with the active ed25519 key, and
 * return a Response with the signature header attached.
 */
export async function signedJsonResponse<T>(data: T, init?: ResponseInit): Promise<Response> {
	const body = JSON.stringify(data);
	const [signature, { keyId }] = await Promise.all([signPayload(body), getSigningKey()]);

	const headers = new Headers(init?.headers);
	headers.set("Content-Type", "application/json");
	headers.set(SIGNATURE_HEADER, formatSignatureHeader(keyId, signature));

	return new Response(body, { ...init, headers });
}

/** Signed 401 response (replacement for `unauthorizedResponse` on UCP/ACP routes). */
export async function signedUnauthorized(message = "Invalid or missing API key"): Promise<Response> {
	const headers = new Headers({ "WWW-Authenticate": "Bearer" });
	return signedJsonResponse({ error: { code: "unauthorized", message } }, { status: 401, headers });
}

/** Signed 404 response for protocols that aren't enabled on this deployment. */
export async function signedProtocolDisabled(protocol: string): Promise<Response> {
	return signedJsonResponse(
		{ error: { code: "not_found", message: `${protocol} is not enabled on this store` } },
		{ status: 404 },
	);
}

function formatSignatureHeader(keyId: string, signature: string): string {
	return `keyid="${keyId}",alg="ed25519",sig="${signature}"`;
}

/** Parse a `UCP-Signature` header value into its components, or `null` if malformed. */
export function parseSignatureHeader(
	header: string | null,
): { keyId: string; alg: string; sig: string } | null {
	if (!header) return null;
	const parts = Object.fromEntries(
		header.split(",").map((segment) => {
			const [k, v] = segment.trim().split("=");
			return [k ?? "", (v ?? "").replace(/^"|"$/g, "")];
		}),
	);
	if (!parts.keyid || !parts.alg || !parts.sig) return null;
	return { keyId: parts.keyid, alg: parts.alg, sig: parts.sig };
}
