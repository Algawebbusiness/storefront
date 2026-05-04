import { describe, it, expect, vi, afterEach } from "vitest";
import {
	signPayload,
	verifySignature,
	getSigningKey,
	importPublicKeyFromBase64,
} from "@/lib/protocols/shared/signing";

describe("Ed25519 signing — signPayload", () => {
	it("returns a base64 string of length 88 (64-byte signature)", async () => {
		const sig = await signPayload({ foo: "bar" });
		expect(typeof sig).toBe("string");
		expect(sig).toHaveLength(88);
		// 64 raw bytes round-trip through base64 to length 88 (with `=` padding).
	});

	it("accepts string payloads", async () => {
		const sig = await signPayload("hello world");
		expect(sig).toHaveLength(88);
	});

	it("produces deterministic signatures for identical input (ed25519 is deterministic)", async () => {
		const sig1 = await signPayload({ a: 1, b: 2 });
		const sig2 = await signPayload({ a: 1, b: 2 });
		expect(sig1).toBe(sig2);
	});
});

describe("Ed25519 signing — verifySignature", () => {
	it("verifies a valid signature roundtrip (object payload)", async () => {
		const payload = { hello: "world", n: 42 };
		const sig = await signPayload(payload);
		const { publicKey } = await getSigningKey();
		await expect(verifySignature(payload, sig, publicKey)).resolves.toBe(true);
	});

	it("verifies a valid signature roundtrip (string payload)", async () => {
		const payload = "raw text payload";
		const sig = await signPayload(payload);
		const { publicKey } = await getSigningKey();
		await expect(verifySignature(payload, sig, publicKey)).resolves.toBe(true);
	});

	it("returns false when the payload is tampered", async () => {
		const sig = await signPayload({ foo: "bar" });
		const { publicKey } = await getSigningKey();
		await expect(verifySignature({ foo: "baz" }, sig, publicKey)).resolves.toBe(false);
	});

	it("returns false when the signature is corrupted", async () => {
		const payload = { foo: "bar" };
		const sig = await signPayload(payload);
		const { publicKey } = await getSigningKey();
		// Flip the first byte of the signature.
		const sigBytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
		sigBytes[0] = (sigBytes[0]! ^ 0xff) & 0xff;
		const corrupted = btoa(String.fromCharCode(...sigBytes));
		await expect(verifySignature(payload, corrupted, publicKey)).resolves.toBe(false);
	});

	it("returns false for a malformed (non-base64) signature", async () => {
		const { publicKey } = await getSigningKey();
		await expect(verifySignature({ foo: "bar" }, "not-base64!!!", publicKey)).resolves.toBe(false);
	});
});

describe("getSigningKey — environment handling", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("throws in production when env vars are missing", async () => {
		vi.resetModules();
		vi.stubEnv("NODE_ENV", "production");
		vi.stubEnv("UCP_SIGNING_PRIVATE_KEY", "");
		vi.stubEnv("UCP_SIGNING_PUBLIC_KEY", "");

		const mod = await import("@/lib/protocols/shared/signing");
		await expect(mod.getSigningKey()).rejects.toThrow(/UCP_SIGNING_PRIVATE_KEY/);
	});

	it("loads keys from env when both private and public are set", async () => {
		vi.resetModules();
		// Generate a fresh keypair, export to base64, then feed it back in via env.
		const subtle = globalThis.crypto.subtle;
		const pair = (await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
		const publicRaw = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
		const privateJwk = await subtle.exportKey("jwk", pair.privateKey);
		const dB64Url = privateJwk.d!;
		const dB64 = dB64Url.replace(/-/g, "+").replace(/_/g, "/");
		const padded = dB64.padEnd(Math.ceil(dB64.length / 4) * 4, "=");
		const privateRaw = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));

		const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
		vi.stubEnv("NODE_ENV", "test");
		vi.stubEnv("UCP_SIGNING_PRIVATE_KEY", toBase64(privateRaw));
		vi.stubEnv("UCP_SIGNING_PUBLIC_KEY", toBase64(publicRaw));
		vi.stubEnv("UCP_SIGNING_KEY_ID", "test-key-2026");

		const mod = await import("@/lib/protocols/shared/signing");
		const key = await mod.getSigningKey();
		expect(key.keyId).toBe("test-key-2026");

		// Sign with the loaded key and verify against the same public key (re-imported).
		const sig = await mod.signPayload({ test: true });
		const importedPub = await mod.importPublicKeyFromBase64(toBase64(publicRaw));
		await expect(mod.verifySignature({ test: true }, sig, importedPub)).resolves.toBe(true);
	});
});

describe("importPublicKeyFromBase64", () => {
	it("imports a key that can verify signatures from the matching private key", async () => {
		const { publicKey } = await getSigningKey();
		const raw = new Uint8Array(await globalThis.crypto.subtle.exportKey("raw", publicKey));
		const b64 = btoa(String.fromCharCode(...raw));

		const reimported = await importPublicKeyFromBase64(b64);
		const sig = await signPayload({ ok: true });
		await expect(verifySignature({ ok: true }, sig, reimported)).resolves.toBe(true);
	});
});
