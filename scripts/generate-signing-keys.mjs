#!/usr/bin/env node
/**
 * Generate an ed25519 keypair for UCP/ACP response signing (Phase A1).
 *
 * Outputs three env vars to stdout:
 *   UCP_SIGNING_PRIVATE_KEY  — 32-byte private seed, base64
 *   UCP_SIGNING_PUBLIC_KEY   — 32-byte public key, base64
 *   UCP_SIGNING_KEY_ID       — opaque kid published in /.well-known/ucp
 *
 * Usage:
 *   node scripts/generate-signing-keys.mjs >> .env
 *
 * Note: Web Crypto exports Ed25519 private keys via "jwk" (or "pkcs8"), not "raw"
 * — so we extract the 32-byte seed from the JWK `d` field to keep the env format compact.
 */

import { webcrypto as crypto } from "node:crypto";

function bytesToBase64(bytes) {
	return Buffer.from(bytes).toString("base64");
}

function base64UrlToBytes(b64url) {
	const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
	const padded = b64.padEnd(Math.ceil(b64.length / 4) * 4, "=");
	return new Uint8Array(Buffer.from(padded, "base64"));
}

const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);

const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);

if (typeof privateJwk.d !== "string") {
	throw new Error("Unexpected: exported Ed25519 JWK has no `d` field");
}

const privateKeyRaw = base64UrlToBytes(privateJwk.d);

if (privateKeyRaw.length !== 32) {
	throw new Error(`Unexpected private key length: ${privateKeyRaw.length} (expected 32)`);
}
if (publicKeyRaw.length !== 32) {
	throw new Error(`Unexpected public key length: ${publicKeyRaw.length} (expected 32)`);
}

const month = new Date().toISOString().slice(0, 7);

console.log(`UCP_SIGNING_PRIVATE_KEY="${bytesToBase64(privateKeyRaw)}"`);
console.log(`UCP_SIGNING_PUBLIC_KEY="${bytesToBase64(publicKeyRaw)}"`);
console.log(`UCP_SIGNING_KEY_ID="algaweb-${month}"`);
