/**
 * OAuth2 authorization code store (durable; see `@/lib/store`).
 *
 * Authorization codes are short-lived (5 min), single-use tokens that bind
 * together: client, redirect_uri, PKCE challenge, scope, and the authenticated
 * Saleor session.
 *
 * Security:
 * - Codes generated with crypto.randomBytes (256 bits of entropy)
 * - Single-use enforced ATOMICALLY via `getdel` (replay-safe across instances)
 * - Auto-expire after AUTH_CODE_TTL (store TTL)
 * - Bound to specific client_id and redirect_uri
 * - Saleor tokens kept in the store, never exposed to the client
 */

import { randomBytes } from "crypto";
import { AUTH_CODE_TTL } from "./config";
import { getStore } from "@/lib/store";

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
}

const KEY_PREFIX = "oauth:code:";
const TTL_SECONDS = Math.ceil(AUTH_CODE_TTL / 1000);

/** Generate and store a new authorization code. */
export async function createAuthorizationCode(params: {
	clientId: string;
	redirectUri: string;
	scope: string;
	codeChallenge: string;
	codeChallengeMethod: "S256";
	saleorAccessToken: string;
	saleorRefreshToken: string;
	userId: string;
	userEmail: string;
}): Promise<string> {
	const code = randomBytes(32).toString("hex");
	const record: StoredAuthorizationCode = { code, ...params, createdAt: Date.now() };
	await getStore().set(KEY_PREFIX + code, JSON.stringify(record), TTL_SECONDS);
	return code;
}

/**
 * Consume an authorization code (single-use). Returns the stored data if valid,
 * null if the code doesn't exist, expired, was already used, or the
 * client_id/redirect_uri binding doesn't match.
 *
 * The code is removed atomically on first lookup (`getdel`), so a replayed code
 * — or a mismatched-binding attempt — cannot be exchanged a second time.
 */
export async function consumeAuthorizationCode(
	code: string,
	clientId: string,
	redirectUri: string,
): Promise<StoredAuthorizationCode | null> {
	const raw = await getStore().getdel(KEY_PREFIX + code);
	if (!raw) return null;

	let stored: StoredAuthorizationCode;
	try {
		stored = JSON.parse(raw) as StoredAuthorizationCode;
	} catch {
		return null;
	}

	if (stored.clientId !== clientId || stored.redirectUri !== redirectUri) {
		console.warn(`[OAuth] Code mismatch: expected client=${stored.clientId}, got ${clientId}`);
		return null;
	}

	return stored;
}
