import { describe, expect, it } from "vitest";
import {
	SIGNATURE_HEADER,
	parseSignatureHeader,
	signedJsonResponse,
	signedProtocolDisabled,
	signedUnauthorized,
} from "@/lib/protocols/shared/response";
import { getSigningKey, verifySignature } from "@/lib/protocols/shared/signing";

describe("signedJsonResponse", () => {
	it("returns JSON body with a UCP-Signature header", async () => {
		const res = await signedJsonResponse({ hello: "world" });
		expect(res.headers.get("Content-Type")).toBe("application/json");
		const sigHeader = res.headers.get(SIGNATURE_HEADER);
		expect(sigHeader).toMatch(/^keyid="[^"]+",alg="ed25519",sig="[^"]+"$/);

		const body = await res.text();
		expect(JSON.parse(body)).toEqual({ hello: "world" });
	});

	it("propagates status and custom headers from init", async () => {
		const res = await signedJsonResponse({ ok: true }, { status: 201, headers: { "X-Custom": "yes" } });
		expect(res.status).toBe(201);
		expect(res.headers.get("X-Custom")).toBe("yes");
		expect(res.headers.get(SIGNATURE_HEADER)).not.toBeNull();
	});

	it("produces a signature an agent can verify against the published public key", async () => {
		const res = await signedJsonResponse({ order: "ord_123", amount: 4200 });
		const body = await res.text();
		const parsed = parseSignatureHeader(res.headers.get(SIGNATURE_HEADER));
		expect(parsed).not.toBeNull();

		const { publicKey, keyId } = await getSigningKey();
		expect(parsed!.keyId).toBe(keyId);
		expect(parsed!.alg).toBe("ed25519");

		await expect(verifySignature(body, parsed!.sig, publicKey)).resolves.toBe(true);
	});

	it("a signature does not verify against a tampered body", async () => {
		const res = await signedJsonResponse({ amount: 100 });
		const parsed = parseSignatureHeader(res.headers.get(SIGNATURE_HEADER));
		const { publicKey } = await getSigningKey();
		await expect(verifySignature('{"amount":999}', parsed!.sig, publicKey)).resolves.toBe(false);
	});
});

describe("signedUnauthorized", () => {
	it("returns 401 with WWW-Authenticate and a signed body", async () => {
		const res = await signedUnauthorized();
		expect(res.status).toBe(401);
		expect(res.headers.get("WWW-Authenticate")).toBe("Bearer");
		expect(res.headers.get(SIGNATURE_HEADER)).not.toBeNull();

		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe("unauthorized");
	});
});

describe("signedProtocolDisabled", () => {
	it("returns 404 with a signed body referencing the protocol name", async () => {
		const res = await signedProtocolDisabled("UCP");
		expect(res.status).toBe(404);
		expect(res.headers.get(SIGNATURE_HEADER)).not.toBeNull();

		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe("not_found");
		expect(body.error.message).toContain("UCP");
	});
});

describe("parseSignatureHeader", () => {
	it("returns null for missing header", () => {
		expect(parseSignatureHeader(null)).toBeNull();
	});

	it("returns null when required components are missing", () => {
		expect(parseSignatureHeader('keyid="x",alg="ed25519"')).toBeNull();
	});

	it("parses a well-formed header", () => {
		expect(parseSignatureHeader('keyid="k1",alg="ed25519",sig="abc"')).toEqual({
			keyId: "k1",
			alg: "ed25519",
			sig: "abc",
		});
	});
});
