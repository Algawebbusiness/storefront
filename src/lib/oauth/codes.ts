/**
 * OAuth2 authorization code store.
 *
 * Authorization codes are short-lived (5 min), single-use tokens
 * that bind together: client, redirect_uri, PKCE challenge, scope,
 * and the authenticated Saleor session.
 *
 * Security:
 * - Codes generated with crypto.randomBytes (256 bits of entropy)
 * - Single-use: marked as used after first exchange
 * - Auto-expire after 5 minutes
 * - Bound to specific client_id and redirect_uri
 * - Store Saleor tokens securely (never exposed to client)
 */

import { randomBytes } from "crypto";
import { AUTH_CODE_TTL } from "./config";

export interface StoredAuthorizationCode {
	code: string;
	clientId: string;
	redirectUri: string;
	scope: string;
	codeChallenge: string;
	codeChallengeMethod: "S256";
	saleorAccessToken: string;
	saleorRefreshToken: string;
	userId: string;
	userEmail: string;
	createdAt: number;
	used: boolean;
}

const codeStore = new Map<string, StoredAuthorizationCode>();

/** Remove expired codes to prevent memory leaks */
function cleanupExpired(): void {
	const now = Date.now();
	for (const [code, data] of codeStore) {
		if (now - data.createdAt > AUTH_CODE_TTL) {
			codeStore.delete(code);
		}
	}
}

/** Generate and store a new authorization code */
export function createAuthorizationCode(params: {
	clientId: string;
	redirectUri: string;
	scope: string;
	codeChallenge: string;
	codeChallengeMethod: "S256";
	saleorAccessToken: string;
	saleorRefreshToken: string;
	userId: string;
	userEmail: string;
}): string {
	cleanupExpired();

	const code = randomBytes(32).toString("hex");

	codeStore.set(code, {
		code,
		...params,
		createdAt: Date.now(),
		used: false,
	});

	return code;
}

/**
 * Consume an authorization code (single-use).
 *
 * Returns the stored data if valid, null if:
 * - Code doesn't exist
 * - Code has expired (5 min)
 * - Code was already used
 * - Client ID doesn't match
 * - Redirect URI doesn't match
 */
export function consumeAuthorizationCode(
	code: string,
	clientId: string,
	redirectUri: string,
): StoredAuthorizationCode | null {
	cleanupExpired();

	const stored = codeStore.get(code);
	if (!stored) return null;

	// Check expiry
	if (Date.now() - stored.createdAt > AUTH_CODE_TTL) {
		codeStore.delete(code);
		return null;
	}

	// Check single-use
	if (stored.used) {
		// Possible replay attack — delete the code entirely
		codeStore.delete(code);
		console.warn(`[OAuth] Authorization code replay attempt for client ${clientId}`);
		return null;
	}

	// Validate binding
	if (stored.clientId !== clientId || stored.redirectUri !== redirectUri) {
		console.warn(`[OAuth] Code mismatch: expected client=${stored.clientId}, got ${clientId}`);
		return null;
	}

	// Mark as used (but keep in store briefly for replay detection)
	stored.used = true;

	return stored;
}
