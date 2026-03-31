import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { verifyPkce, validateCodeChallenge } from "@/lib/oauth/pkce";

/** Helper: compute S256 challenge from a verifier */
function computeS256Challenge(verifier: string): string {
	const hash = createHash("sha256").update(verifier, "ascii").digest();
	return hash.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("PKCE verification", () => {
	// A valid 43-char code_verifier (only unreserved characters)
	const validVerifier = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

	it("verifyPkce returns true for correct S256 challenge/verifier pair", () => {
		const challenge = computeS256Challenge(validVerifier);
		expect(verifyPkce(validVerifier, challenge, "S256")).toBe(true);
	});

	it("verifyPkce returns false for wrong verifier", () => {
		const challenge = computeS256Challenge(validVerifier);
		const wrongVerifier = "ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvutsrqponmlk";
		expect(verifyPkce(wrongVerifier, challenge, "S256")).toBe(false);
	});

	it("verifyPkce returns false for plain method (rejected)", () => {
		expect(verifyPkce(validVerifier, validVerifier, "plain")).toBe(false);
	});

	it("verifyPkce returns false for too-short verifier (<43 chars)", () => {
		const shortVerifier = "abcdefghijklmnopqrstuvwxyz0123456789ABCDE"; // 42 chars
		const challenge = computeS256Challenge(shortVerifier);
		expect(verifyPkce(shortVerifier, challenge, "S256")).toBe(false);
	});

	it("verifyPkce returns false for invalid characters", () => {
		const invalidVerifier = "abcdefghijklmnopqrstuvwxyz0123456789 ABCDEFG"; // space
		const challenge = computeS256Challenge(invalidVerifier);
		expect(verifyPkce(invalidVerifier, challenge, "S256")).toBe(false);
	});
});

describe("validateCodeChallenge", () => {
	it("accepts valid base64url 43-char strings", () => {
		// A real S256 challenge is base64url(SHA-256(verifier)), always 43 chars
		const challenge = computeS256Challenge("abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG");
		expect(validateCodeChallenge(challenge)).toBe(true);
	});

	it("rejects too-short challenges", () => {
		expect(validateCodeChallenge("abc")).toBe(false);
	});

	it("rejects too-long challenges", () => {
		expect(validateCodeChallenge("a".repeat(44))).toBe(false);
	});

	it("rejects challenges with padding characters", () => {
		expect(validateCodeChallenge("abcdefghijklmnopqrstuvwxyz0123456789ABCDE==")).toBe(false);
	});

	it("rejects challenges with invalid characters", () => {
		expect(validateCodeChallenge("abcdefghijklmnopqrstuvwxyz012345678+ABCDEFG")).toBe(false);
	});
});
