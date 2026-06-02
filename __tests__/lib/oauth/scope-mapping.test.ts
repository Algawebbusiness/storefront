import { describe, expect, it } from "vitest";
import { mapOAuthToAgentScopes } from "@/lib/oauth/scopes";

describe("mapOAuthToAgentScopes (CWE-269 — consented scope only)", () => {
	it("checkout scope does NOT grant order access", () => {
		const scopes = mapOAuthToAgentScopes("checkout");
		expect(scopes).toContain("checkout.complete");
		expect(scopes).toContain("cart.create");
		expect(scopes).not.toContain("order.read");
		expect(scopes).not.toContain("order.return");
	});

	it("orders scope grants order read/return but not checkout", () => {
		const scopes = mapOAuthToAgentScopes("orders");
		expect(scopes).toContain("order.read");
		expect(scopes).toContain("order.return");
		expect(scopes).not.toContain("checkout.complete");
	});

	it("unions multiple consented scopes; ignores unknown ones", () => {
		const scopes = mapOAuthToAgentScopes("profile orders bogus");
		expect(scopes).toEqual(expect.arrayContaining(["customer.read", "order.read"]));
		expect(scopes).not.toContain("checkout.complete");
	});

	it("empty / no scope grants nothing", () => {
		expect(mapOAuthToAgentScopes("")).toEqual([]);
	});
});
