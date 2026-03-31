/**
 * OAuth2 client registry and configuration.
 *
 * Clients are configured via OAUTH_CLIENTS env var.
 * Format: client_id:secret_sha256_hex:redirect_uri1|redirect_uri2,client_id2:...
 *
 * Security:
 * - Client secrets stored as SHA-256 hashes (never plaintext)
 * - Redirect URIs validated by exact match
 * - All comparisons use timing-safe equality
 */

import { createHash, timingSafeEqual } from "crypto";
import { type OAuthScope, VALID_SCOPES } from "./scopes";

export interface OAuthClient {
	client_id: string;
	client_secret_hash: string;
	redirect_uris: string[];
	name: string;
	allowed_scopes: OAuthScope[];
}

// Token lifetimes
export const ACCESS_TOKEN_TTL = parseInt(process.env.OAUTH_ACCESS_TOKEN_TTL || "3600", 10);
export const REFRESH_TOKEN_TTL = parseInt(process.env.OAUTH_REFRESH_TOKEN_TTL || "2592000", 10);
export const AUTH_CODE_TTL = 5 * 60 * 1000; // 5 minutes in ms

/** Parse OAUTH_CLIENTS env var into client registry */
function parseClients(): Map<string, OAuthClient> {
	const raw = process.env.OAUTH_CLIENTS || "";
	const clients = new Map<string, OAuthClient>();

	if (!raw.trim()) return clients;

	for (const entry of raw.split(",")) {
		const parts = entry.trim().split(":");
		if (parts.length < 3) {
			console.warn(`[OAuth] Invalid client entry (need id:secret_hash:redirect_uris): ${entry}`);
			continue;
		}

		const [clientId, secretHash, redirectUrisPart, ...rest] = parts;
		// Rejoin remaining parts in case redirect URIs contain colons (e.g., https:)
		const redirectUrisStr = [redirectUrisPart, ...rest].join(":");
		const redirectUris = redirectUrisStr.split("|").map((u) => u.trim()).filter(Boolean);

		if (!clientId || !secretHash || redirectUris.length === 0) {
			console.warn(`[OAuth] Skipping incomplete client entry: ${clientId}`);
			continue;
		}

		clients.set(clientId, {
			client_id: clientId,
			client_secret_hash: secretHash,
			redirect_uris: redirectUris,
			name: clientId, // Display name defaults to client_id
			allowed_scopes: [...VALID_SCOPES],
		});
	}

	return clients;
}

let clientCache: Map<string, OAuthClient> | null = null;

/** Get the client registry (parsed once, cached) */
export function getClientRegistry(): Map<string, OAuthClient> {
	if (!clientCache) {
		clientCache = parseClients();
	}
	return clientCache;
}

/** Look up a client by ID */
export function getClient(clientId: string): OAuthClient | null {
	return getClientRegistry().get(clientId) ?? null;
}

/**
 * Verify a client secret against the stored hash.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyClientSecret(client: OAuthClient, secret: string): boolean {
	const hash = createHash("sha256").update(secret).digest("hex");
	const storedHash = client.client_secret_hash;

	// Ensure both buffers have the same length for timingSafeEqual
	if (hash.length !== storedHash.length) return false;

	return timingSafeEqual(Buffer.from(hash, "utf-8"), Buffer.from(storedHash, "utf-8"));
}

/**
 * Validate that a redirect URI is registered for this client.
 * Exact match required — no wildcards, no path traversal.
 */
export function validateRedirectUri(client: OAuthClient, redirectUri: string): boolean {
	return client.redirect_uris.includes(redirectUri);
}

/** Get the JWT signing secret. Throws if not configured. */
export function getJwtSecret(): string {
	const secret = process.env.OAUTH_JWT_SECRET;
	if (!secret || secret.length < 32) {
		throw new Error("OAUTH_JWT_SECRET must be set and at least 32 characters");
	}
	return secret;
}

/** Hash a client secret for storage in OAUTH_CLIENTS env var */
export function hashClientSecret(secret: string): string {
	return createHash("sha256").update(secret).digest("hex");
}
