import { afterEach, describe, expect, it, vi } from "vitest";

describe("buildUcpProfile (UCP 2026-04-08)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("defaults version to 2026-04-08", async () => {
		vi.resetModules();
		vi.stubEnv("UCP_VERSION", "");
		const { buildUcpProfile } = await import("@/lib/protocols/ucp/profile-builder");
		const profile = await buildUcpProfile();
		expect(profile.ucp.version).toBe("2026-04-08");
	});

	it("emits schema URLs under https://ucp.dev/2026-04-08", async () => {
		vi.resetModules();
		vi.stubEnv("UCP_VERSION", "");
		const { buildUcpProfile } = await import("@/lib/protocols/ucp/profile-builder");
		const profile = await buildUcpProfile();

		const restService = profile.ucp.services["dev.ucp.shopping"]?.find((s) => s.transport === "rest");
		expect(restService?.schema).toMatch(/^https:\/\/ucp\.dev\/2026-04-08\//);
		expect(restService?.spec).toMatch(/^https:\/\/ucp\.dev\/2026-04-08\/specification\//);

		// A9: MCP transport endpoint must point at the real route at /mcp,
		// not the misnamed /api/ucp/mcp the profile-builder used to advertise.
		const mcpService = profile.ucp.services["dev.ucp.shopping"]?.find((s) => s.transport === "mcp");
		expect(mcpService?.endpoint).toMatch(/\/mcp$/);
		expect(mcpService?.endpoint).not.toMatch(/\/api\/ucp\/mcp$/);

		const checkout = profile.ucp.capabilities["dev.ucp.shopping.checkout"]?.[0];
		expect(checkout?.schema).toBe("https://ucp.dev/2026-04-08/schemas/shopping/checkout.json");
		expect(checkout?.spec).toBe("https://ucp.dev/2026-04-08/specification/checkout");
	});

	it("advertises the foundation capabilities including cart (A4) and catalog (A5)", async () => {
		vi.resetModules();
		const { buildUcpProfile } = await import("@/lib/protocols/ucp/profile-builder");
		const profile = await buildUcpProfile();

		expect(Object.keys(profile.ucp.capabilities)).toEqual(
			expect.arrayContaining([
				"dev.ucp.shopping.checkout",
				"dev.ucp.shopping.fulfillment",
				"dev.ucp.shopping.discount",
				"dev.ucp.shopping.cart",
				"dev.ucp.shopping.catalog",
			]),
		);

		const fulfillment = profile.ucp.capabilities["dev.ucp.shopping.fulfillment"]?.[0];
		expect(fulfillment?.extends).toBe("dev.ucp.shopping.checkout");

		const cart = profile.ucp.capabilities["dev.ucp.shopping.cart"]?.[0];
		expect(cart?.schema).toBe("https://ucp.dev/2026-04-08/schemas/shopping/cart.json");
		expect(cart?.extends).toBeUndefined();

		const catalog = profile.ucp.capabilities["dev.ucp.shopping.catalog"]?.[0];
		expect(catalog?.schema).toBe("https://ucp.dev/2026-04-08/schemas/shopping/catalog.json");
		expect(catalog?.extends).toBeUndefined();
	});

	it("respects an explicit UCP_VERSION override", async () => {
		vi.resetModules();
		vi.stubEnv("UCP_VERSION", "2026-99-99");
		const { buildUcpProfile } = await import("@/lib/protocols/ucp/profile-builder");
		const profile = await buildUcpProfile();
		expect(profile.ucp.version).toBe("2026-99-99");
		const checkout = profile.ucp.capabilities["dev.ucp.shopping.checkout"]?.[0];
		expect(checkout?.schema).toMatch(/^https:\/\/ucp\.dev\/2026-99-99\//);
	});

	it("publishes a non-empty signing_keys array (populated in A3)", async () => {
		vi.resetModules();
		const { buildUcpProfile } = await import("@/lib/protocols/ucp/profile-builder");
		const profile = await buildUcpProfile();
		expect(profile.signing_keys).toHaveLength(1);
		const key = profile.signing_keys[0]!;
		expect(key.algorithm).toBe("ed25519");
		expect(key.kid).toBeTypeOf("string");
		expect(key.kid.length).toBeGreaterThan(0);
		// Raw 32-byte ed25519 public key → base64 length 44 (with padding).
		expect(key.public_key).toHaveLength(44);
	});
});

describe("buildUcpProfile — payment handler instruments (A6)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("does not advertise the Stripe handler when no publishable key is set", async () => {
		vi.resetModules();
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "");
		const { buildUcpProfile } = await import("@/lib/protocols/ucp/profile-builder");
		const profile = await buildUcpProfile();
		expect(profile.ucp.payment_handlers).toEqual({});
	});

	it("advertises the Stripe handler with default instruments=['card'] when env override is absent", async () => {
		vi.resetModules();
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_123");
		vi.stubEnv("STRIPE_AVAILABLE_INSTRUMENTS", "");
		const { buildUcpProfile } = await import("@/lib/protocols/ucp/profile-builder");
		const profile = await buildUcpProfile();

		const handlers = profile.ucp.payment_handlers["com.stripe.shared_payment_token"];
		expect(handlers).toHaveLength(1);
		const handler = handlers![0]!;
		expect(handler.id).toBe("stripe_spt");
		expect(handler.config.publishable_key).toBe("pk_test_123");
		expect(handler.config.available_payment_instruments).toEqual(["card"]);
	});

	it("parses STRIPE_AVAILABLE_INSTRUMENTS comma-separated, trimming whitespace", async () => {
		vi.resetModules();
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_123");
		vi.stubEnv("STRIPE_AVAILABLE_INSTRUMENTS", "card, apple_pay,google_pay ,klarna ,affirm");
		const { buildUcpProfile } = await import("@/lib/protocols/ucp/profile-builder");
		const profile = await buildUcpProfile();

		const handler = profile.ucp.payment_handlers["com.stripe.shared_payment_token"]![0]!;
		expect(handler.config.available_payment_instruments).toEqual([
			"card",
			"apple_pay",
			"google_pay",
			"klarna",
			"affirm",
		]);
	});

	it("falls back to default ['card'] when STRIPE_AVAILABLE_INSTRUMENTS is only commas/whitespace", async () => {
		vi.resetModules();
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_123");
		vi.stubEnv("STRIPE_AVAILABLE_INSTRUMENTS", " , , ,");
		const { buildUcpProfile } = await import("@/lib/protocols/ucp/profile-builder");
		const profile = await buildUcpProfile();
		const handler = profile.ucp.payment_handlers["com.stripe.shared_payment_token"]![0]!;
		expect(handler.config.available_payment_instruments).toEqual(["card"]);
	});

	it("accepts open-enum strings (region-specific instruments not in the closed list)", async () => {
		vi.resetModules();
		vi.stubEnv("STRIPE_PUBLISHABLE_KEY", "pk_test_123");
		vi.stubEnv("STRIPE_AVAILABLE_INSTRUMENTS", "card,cz.comgate,sk.tatrapay");
		const { buildUcpProfile } = await import("@/lib/protocols/ucp/profile-builder");
		const profile = await buildUcpProfile();
		const handler = profile.ucp.payment_handlers["com.stripe.shared_payment_token"]![0]!;
		expect(handler.config.available_payment_instruments).toEqual(["card", "cz.comgate", "sk.tatrapay"]);
	});
});

describe("buildUcpProfile — accepted_platforms (B8)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("omits accepted_platforms when no agents are registered", async () => {
		vi.resetModules();
		vi.stubEnv("AGENT_REGISTRY_JSON", "");
		vi.stubEnv("PAYLOAD_API_URL", "");
		const { buildUcpProfile } = await import("@/lib/protocols/ucp/profile-builder");
		const profile = await buildUcpProfile();
		expect(profile.accepted_platforms).toBeUndefined();
	});

	it("groups agents by platform, drops 'custom', surfaces public_keys", async () => {
		vi.resetModules();
		vi.stubEnv("PAYLOAD_API_URL", "");
		vi.stubEnv(
			"AGENT_REGISTRY_JSON",
			JSON.stringify([
				{
					id: "openai-prod",
					display_name: "ChatGPT",
					platform: "openai",
					status: "active",
					public_key: "AAA=",
					scope: ["catalog.read"],
					spending_limit: { per_session_cents: null, per_day_cents: null, per_month_cents: null },
					rate_limit: { requests_per_minute: 60, sessions_per_day: 500 },
					created_at: "2026-05-01T00:00:00Z",
					updated_at: "2026-05-01T00:00:00Z",
				},
				{
					id: "openai-staging",
					display_name: "ChatGPT staging",
					platform: "openai",
					status: "active",
					public_key: "BBB=",
					scope: ["catalog.read"],
					spending_limit: { per_session_cents: null, per_day_cents: null, per_month_cents: null },
					rate_limit: { requests_per_minute: 60, sessions_per_day: 500 },
					created_at: "2026-05-01T00:00:00Z",
					updated_at: "2026-05-01T00:00:00Z",
				},
				{
					id: "internal-tool",
					display_name: "Internal scheduler",
					platform: "custom",
					status: "active",
					public_key: "CCC=",
					scope: ["catalog.read"],
					spending_limit: { per_session_cents: null, per_day_cents: null, per_month_cents: null },
					rate_limit: { requests_per_minute: 60, sessions_per_day: 500 },
					created_at: "2026-05-01T00:00:00Z",
					updated_at: "2026-05-01T00:00:00Z",
				},
			]),
		);

		const { buildUcpProfile } = await import("@/lib/protocols/ucp/profile-builder");
		const profile = await buildUcpProfile();
		expect(profile.accepted_platforms).toBeDefined();
		const openai = profile.accepted_platforms!.find((p) => p.platform === "openai");
		expect(openai).toBeDefined();
		expect(openai!.display_name).toContain("OpenAI");
		expect(openai!.trust_level).toBe("verified");
		expect(openai!.public_keys.sort()).toEqual(["AAA=", "BBB="]);
		// 'custom' platform must not surface in the public profile
		expect(profile.accepted_platforms!.some((p) => (p.platform as string) === "custom")).toBe(false);
	});

	it("excludes suspended/revoked agents from accepted_platforms", async () => {
		vi.resetModules();
		vi.stubEnv("PAYLOAD_API_URL", "");
		vi.stubEnv(
			"AGENT_REGISTRY_JSON",
			JSON.stringify([
				{
					id: "g1",
					display_name: "Gemini active",
					platform: "google",
					status: "active",
					public_key: "GA=",
					scope: ["catalog.read"],
					spending_limit: { per_session_cents: null, per_day_cents: null, per_month_cents: null },
					rate_limit: { requests_per_minute: 60, sessions_per_day: 500 },
					created_at: "2026-05-01T00:00:00Z",
					updated_at: "2026-05-01T00:00:00Z",
				},
				{
					id: "g2",
					display_name: "Gemini suspended",
					platform: "google",
					status: "suspended",
					public_key: "GS=",
					scope: ["catalog.read"],
					spending_limit: { per_session_cents: null, per_day_cents: null, per_month_cents: null },
					rate_limit: { requests_per_minute: 60, sessions_per_day: 500 },
					created_at: "2026-05-01T00:00:00Z",
					updated_at: "2026-05-01T00:00:00Z",
				},
			]),
		);

		const { buildUcpProfile } = await import("@/lib/protocols/ucp/profile-builder");
		const profile = await buildUcpProfile();
		const google = profile.accepted_platforms!.find((p) => p.platform === "google");
		expect(google!.public_keys).toEqual(["GA="]);
	});

	it("excludes agents with empty public_key (synthetic legacy bearer)", async () => {
		vi.resetModules();
		vi.stubEnv("PAYLOAD_API_URL", "");
		vi.stubEnv(
			"AGENT_REGISTRY_JSON",
			JSON.stringify([
				{
					id: "real",
					display_name: "Anthropic real",
					platform: "anthropic",
					status: "active",
					public_key: "AN=",
					scope: ["catalog.read"],
					spending_limit: { per_session_cents: null, per_day_cents: null, per_month_cents: null },
					rate_limit: { requests_per_minute: 60, sessions_per_day: 500 },
					created_at: "2026-05-01T00:00:00Z",
					updated_at: "2026-05-01T00:00:00Z",
				},
				{
					id: "unkeyed",
					display_name: "Anthropic legacy",
					platform: "anthropic",
					status: "active",
					public_key: "",
					scope: ["catalog.read"],
					spending_limit: { per_session_cents: null, per_day_cents: null, per_month_cents: null },
					rate_limit: { requests_per_minute: 60, sessions_per_day: 500 },
					created_at: "2026-05-01T00:00:00Z",
					updated_at: "2026-05-01T00:00:00Z",
				},
			]),
		);

		const { buildUcpProfile } = await import("@/lib/protocols/ucp/profile-builder");
		const profile = await buildUcpProfile();
		const anthropic = profile.accepted_platforms!.find((p) => p.platform === "anthropic");
		expect(anthropic!.public_keys).toEqual(["AN="]);
	});
});
