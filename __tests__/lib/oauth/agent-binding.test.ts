import { afterEach, describe, expect, it, vi } from "vitest";
import { getAgentForOauthClient } from "@/lib/oauth/config";
import { createTokenPair, verifyJwt } from "@/lib/oauth/tokens";

describe("getAgentForOauthClient — Phase B7 mapping", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns null when OAUTH_CLIENT_AGENT_MAPPING is unset", () => {
		vi.stubEnv("OAUTH_CLIENT_AGENT_MAPPING", "");
		expect(getAgentForOauthClient("anything")).toBeNull();
	});

	it("returns null for unknown client_id even when mapping is set", () => {
		vi.stubEnv("OAUTH_CLIENT_AGENT_MAPPING", JSON.stringify({ "openai-chatgpt": "openai-prod" }));
		expect(getAgentForOauthClient("unknown")).toBeNull();
	});

	it("returns the mapped agent_id for a registered client", () => {
		vi.stubEnv(
			"OAUTH_CLIENT_AGENT_MAPPING",
			JSON.stringify({
				"openai-chatgpt": "openai-prod",
				"google-gemini": "google-search",
			}),
		);
		expect(getAgentForOauthClient("openai-chatgpt")).toBe("openai-prod");
		expect(getAgentForOauthClient("google-gemini")).toBe("google-search");
	});

	it("returns null when the JSON is malformed (no throw)", () => {
		vi.stubEnv("OAUTH_CLIENT_AGENT_MAPPING", "{not valid json");
		expect(getAgentForOauthClient("anything")).toBeNull();
	});

	it("returns null when the env value is an array (must be an object)", () => {
		vi.stubEnv("OAUTH_CLIENT_AGENT_MAPPING", JSON.stringify(["x"]));
		expect(getAgentForOauthClient("anything")).toBeNull();
	});

	it("returns null when the mapped value is not a string", () => {
		vi.stubEnv("OAUTH_CLIENT_AGENT_MAPPING", JSON.stringify({ openai: 42 }));
		expect(getAgentForOauthClient("openai")).toBeNull();
	});
});

describe("createTokenPair — agent_id JWT claim", () => {
	beforeAll();

	function beforeAll() {
		// Need a JWT secret to issue tokens
		process.env.OAUTH_JWT_SECRET = "test-secret-must-be-at-least-32-chars-long-yes";
	}

	it("omits agent_id claim when agentId is not provided", async () => {
		const { access_token } = await createTokenPair({
			userId: "u1",
			email: "u@x.cz",
			scope: "profile",
			clientId: "c1",
			saleorToken: "st",
			saleorRefreshToken: "rt",
		});
		const payload = verifyJwt(access_token);
		expect(payload).not.toBeNull();
		expect(payload?.agent_id).toBeUndefined();
	});

	it("includes agent_id claim when agentId is provided (B7 binding)", async () => {
		const { access_token } = await createTokenPair({
			userId: "u1",
			email: "u@x.cz",
			scope: "profile",
			clientId: "c1",
			saleorToken: "st",
			saleorRefreshToken: "rt",
			agentId: "openai-prod",
		});
		const payload = verifyJwt(access_token);
		expect(payload?.agent_id).toBe("openai-prod");
	});

	it("propagates agent_id into the refresh token (so refresh preserves binding)", async () => {
		const { refresh_token } = await createTokenPair({
			userId: "u1",
			email: "u@x.cz",
			scope: "profile",
			clientId: "c1",
			saleorToken: "st",
			saleorRefreshToken: "rt",
			agentId: "openai-prod",
		});
		const payload = verifyJwt(refresh_token);
		expect(payload?.agent_id).toBe("openai-prod");
		expect(payload?.type).toBe("refresh");
	});
});
