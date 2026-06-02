import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { _resetStore } from "@/lib/store";

describe("rateLimit (CWE-307)", () => {
	beforeEach(() => _resetStore());
	afterEach(() => _resetStore());

	it("allows up to max within the window, then blocks with a Retry-After", async () => {
		for (let i = 0; i < 3; i++) {
			expect((await rateLimit("k", 3, 600)).allowed).toBe(true);
		}
		const blocked = await rateLimit("k", 3, 600);
		expect(blocked.allowed).toBe(false);
		expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
	});

	it("tracks distinct keys independently", async () => {
		expect((await rateLimit("a", 1, 600)).allowed).toBe(true);
		expect((await rateLimit("a", 1, 600)).allowed).toBe(false);
		expect((await rateLimit("b", 1, 600)).allowed).toBe(true);
	});
});

describe("clientIp", () => {
	it("prefers cf-connecting-ip, falls back to x-forwarded-for", () => {
		const cf = new Request("https://x/", { headers: { "cf-connecting-ip": "1.2.3.4" } });
		expect(clientIp(cf)).toBe("1.2.3.4");
		const xff = new Request("https://x/", { headers: { "x-forwarded-for": "5.6.7.8, 9.9.9.9" } });
		expect(clientIp(xff)).toBe("5.6.7.8");
		expect(clientIp(new Request("https://x/"))).toBe("unknown");
	});
});
