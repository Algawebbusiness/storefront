/**
 * Ed25519 signing for UCP/ACP responses (Phase A1).
 *
 * Uses Web Crypto API (`globalThis.crypto.subtle`) — works in Node 20+, Vercel Edge,
 * and Cloudflare Workers. Do NOT import from `node:crypto` here, because the UCP/ACP
 * routes deploy to edge runtimes where the Node crypto module is unavailable.
 *
 * Keys are stored as base64-encoded raw 32-byte values in env:
 *   UCP_SIGNING_PRIVATE_KEY  — 32B private seed, base64
 *   UCP_SIGNING_PUBLIC_KEY   — 32B public key, base64
 *   UCP_SIGNING_KEY_ID       — opaque kid exposed via /.well-known/ucp
 *
 * Generate values with:  `node scripts/generate-signing-keys.mjs`
 *
 * Behavior when env is missing:
 *   - production → throws with a clear message
 *   - any other NODE_ENV → generates an ephemeral keypair with a warning
 */

export interface SigningKey {
	privateKey: CryptoKey;
	publicKey: CryptoKey;
	keyId: string;
}

let cached: Promise<SigningKey> | null = null;

export async function getSigningKey(): Promise<SigningKey> {
	if (!cached) cached = loadSigningKey();
	return cached;
}

export async function signPayload(payload: string | object): Promise<string> {
	const { privateKey } = await getSigningKey();
	const data = encodePayload(payload);
	const signature = await subtle().sign("Ed25519", privateKey, data);
	return bytesToBase64(new Uint8Array(signature));
}

export async function verifySignature(
	payload: string | object,
	signature: string,
	publicKey: CryptoKey,
): Promise<boolean> {
	try {
		const data = encodePayload(payload);
		const sigBytes = base64ToBytes(signature);
		return await subtle().verify("Ed25519", publicKey, sigBytes, data);
	} catch {
		return false;
	}
}

/** Import a base64-encoded 32-byte ed25519 public key into a CryptoKey for verification. */
export async function importPublicKeyFromBase64(base64PublicKey: string): Promise<CryptoKey> {
	return importPublicKey(base64ToBytes(base64PublicKey));
}

/**
 * Export the active signing key's public part as base64-encoded raw 32 bytes.
 * Used by the UCP profile builder to publish `signing_keys[].public_key`.
 */
export async function getPublicKeyBase64(): Promise<string> {
	const { publicKey } = await getSigningKey();
	const raw = await subtle().exportKey("raw", publicKey);
	return bytesToBase64(new Uint8Array(raw));
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

async function loadSigningKey(): Promise<SigningKey> {
	const privateB64 = process.env.UCP_SIGNING_PRIVATE_KEY;
	const publicB64 = process.env.UCP_SIGNING_PUBLIC_KEY;
	const keyId = process.env.UCP_SIGNING_KEY_ID;

	if (privateB64 && publicB64) {
		const privateRaw = base64ToBytes(privateB64);
		const publicRaw = base64ToBytes(publicB64);
		if (privateRaw.length !== 32 || publicRaw.length !== 32) {
			throw new Error(
				"UCP_SIGNING_PRIVATE_KEY / UCP_SIGNING_PUBLIC_KEY must each decode to exactly 32 bytes. " +
					"Regenerate with `node scripts/generate-signing-keys.mjs`.",
			);
		}
		const [privateKey, publicKey] = await Promise.all([
			importPrivateKey(privateRaw, publicRaw),
			importPublicKey(publicRaw),
		]);
		return { privateKey, publicKey, keyId: keyId ?? "ucp-signing-key" };
	}

	if (process.env.NODE_ENV === "production") {
		throw new Error(
			"UCP_SIGNING_PRIVATE_KEY and UCP_SIGNING_PUBLIC_KEY must be set in production. " +
				"Run `node scripts/generate-signing-keys.mjs` and add the output to your environment.",
		);
	}

	console.warn(
		"[ucp/signing] UCP_SIGNING_PRIVATE_KEY / UCP_SIGNING_PUBLIC_KEY not set — " +
			"generating ephemeral ed25519 keypair. Run `node scripts/generate-signing-keys.mjs` " +
			"and persist the output to .env for stable signatures across restarts.",
	);

	const pair = (await subtle().generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
	return {
		privateKey: pair.privateKey,
		publicKey: pair.publicKey,
		keyId: keyId ?? "ucp-dev-ephemeral",
	};
}

async function importPrivateKey(privateRaw: Uint8Array, publicRaw: Uint8Array): Promise<CryptoKey> {
	const jwk: JsonWebKey = {
		kty: "OKP",
		crv: "Ed25519",
		d: bytesToBase64Url(privateRaw),
		x: bytesToBase64Url(publicRaw),
		key_ops: ["sign"],
		ext: true,
	};
	return subtle().importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
}

async function importPublicKey(publicRaw: Uint8Array): Promise<CryptoKey> {
	return subtle().importKey("raw", publicRaw, { name: "Ed25519" }, true, ["verify"]);
}

function subtle(): SubtleCrypto {
	const c = globalThis.crypto;
	if (!c?.subtle) {
		throw new Error("Web Crypto API (globalThis.crypto.subtle) is not available in this runtime.");
	}
	return c.subtle;
}

function encodePayload(payload: string | object): Uint8Array {
	const text = typeof payload === "string" ? payload : JSON.stringify(payload);
	return new TextEncoder().encode(text);
}

function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

function bytesToBase64Url(bytes: Uint8Array): string {
	return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
