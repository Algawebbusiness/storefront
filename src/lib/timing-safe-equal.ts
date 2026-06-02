import { createHash, timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison for secrets/tokens (CWE-208).
 *
 * Hashes both inputs to a fixed-length digest before comparing, so the
 * comparison is both timing-safe and length-safe (`timingSafeEqual` throws on
 * unequal-length buffers and a naive compare leaks length). Use for any
 * attacker-supplied secret/bearer check.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
	const ha = createHash("sha256").update(a, "utf8").digest();
	const hb = createHash("sha256").update(b, "utf8").digest();
	return timingSafeEqual(ha, hb);
}
