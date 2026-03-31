/**
 * PKCE (Proof Key for Code Exchange) verification.
 *
 * Only S256 method is supported (SHA-256 hash of code_verifier).
 * Plain method is explicitly rejected for security.
 *
 * @see https://datatracker.ietf.org/doc/html/rfc7636
 */

import { createHash, timingSafeEqual } from "crypto";

/** Base64url encode (no padding) per RFC 7636 Appendix A */
function base64url(buffer: Buffer): string {
	return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Verify a PKCE code_verifier against the stored code_challenge.
 *
 * @param codeVerifier - The verifier sent by the client in the token request
 * @param codeChallenge - The challenge stored during authorization
 * @param method - Must be "S256"
 * @returns true if verification passes
 */
export function verifyPkce(codeVerifier: string, codeChallenge: string, method: string): boolean {
	if (method !== "S256") {
		return false;
	}

	// RFC 7636: code_verifier must be 43-128 characters, [A-Z] / [a-z] / [0-9] / "-" / "." / "_" / "~"
	if (codeVerifier.length < 43 || codeVerifier.length > 128) {
		return false;
	}

	if (!/^[A-Za-z0-9\-._~]+$/.test(codeVerifier)) {
		return false;
	}

	const hash = createHash("sha256").update(codeVerifier, "ascii").digest();
	const computed = base64url(hash);

	// Timing-safe comparison
	if (computed.length !== codeChallenge.length) {
		return false;
	}

	return timingSafeEqual(Buffer.from(computed, "utf-8"), Buffer.from(codeChallenge, "utf-8"));
}

/**
 * Validate a code_challenge format.
 * Must be base64url without padding, 43 characters for SHA-256.
 */
export function validateCodeChallenge(challenge: string): boolean {
	return /^[A-Za-z0-9\-_]{43}$/.test(challenge);
}
