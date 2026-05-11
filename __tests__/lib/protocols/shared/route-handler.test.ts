/**
 * Unit tests for `withUcpRoute`.
 *
 * Each test exercises one piece of the guard chain (feature flag, auth, scope,
 * rate limits, audit log) without touching Saleor or Payload.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	withUcpRoute,
	type UcpRouteAuth,
} from "@/lib/protocols/shared/route-handler";
import { _resetEnvRegistryCache } from "@/lib/protocols/shared/agent-registry";
import { _resetLimitBuckets } from "@/lib/protocols/shared/limits";
import { signedJsonResponse } from "@/lib/protocols/shared/response";

function bearerRequest(opts: { method?: string; body?: string } = {}): Request {
	return new Request("https://store.example/api/ucp/rest/test", {
		method: opts.method ?? "POST",
		body: opts.body,
		headers: { Authorization: "Bearer dev-anything" },
	});
}

function devModeEnv(): void {
	vi.stubEnv("UCP_ENABLED", "true");
	vi.stubEnv("AGENT_API_KEYS", "");
	vi.stubEnv("AGENT_REGISTRY_JSON", "");
	vi.stubEnv("PAYLOAD_API_URL", "");
}

describe("withUcpRoute", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		_resetLimitBuckets();
		_resetEnvRegistryCache();
	});

	afterEach(() => {
		logSpy.mockRestore();
		warnSpy.mockRestore();
		vi.unstubAllEnvs();
		_resetLimitBuckets();
		_resetEnvRegistryCache();
	});

	it("returns 404 when UCP_ENABLED is not 'true'", async () => {
		vi.stubEnv("UCP_ENABLED", "false");
		const handler = withUcpRoute(
			{ action: "cart.create", scope: "cart.create" },
			async () => signedJsonResponse({ ok: true }, { status: 200 }),
		);
		const res = await handler(bearerRequest({ body: "{}" }));
		expect(res.status).toBe(404);
	});

	it("returns 401 when no auth header is present", async () => {
		devModeEnv();
		const handler = withUcpRoute(
			{ action: "cart.create", scope: "cart.create" },
			async () => signedJsonResponse({ ok: true }, { status: 200 }),
		);
		const req = new Request("https://store.example/api/ucp/rest/test", {
			method: "POST",
			body: "{}",
		});
		const res = await handler(req);
		expect(res.status).toBe(401);
	});

	it("returns 403 when the agent lacks the required scope", async () => {
		devModeEnv();
		// SYNTHETIC_LEGACY_AGENT doesn't carry `customer.update`, so the route
		// gating on it must reject even a fully authenticated request.
		const handler = withUcpRoute(
			{ action: "customer.update", scope: "customer.update" },
			async () => signedJsonResponse({ ok: true }, { status: 200 }),
		);
		const res = await handler(bearerRequest({ body: "{}" }));
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe("forbidden");
		expect(body.error.message).toMatch(/scope/);
	});

	it("invokes the handler with the verified agent identity", async () => {
		devModeEnv();
		let received: UcpRouteAuth | null = null;
		const handler = withUcpRoute(
			{ action: "cart.create", scope: "cart.create" },
			async (_req, auth) => {
				received = auth;
				return signedJsonResponse({ ok: true }, { status: 200 });
			},
		);
		const res = await handler(bearerRequest({ body: '{"x":1}' }));
		expect(res.status).toBe(200);
		expect(received).not.toBeNull();
		expect(received!.isLegacy).toBe(true);
		expect(received!.agent.scope).toContain("cart.create");
		expect(received!.bodyText).toBe('{"x":1}');
	});

	it("resolves and forwards route params to the handler", async () => {
		devModeEnv();
		let receivedParams: { id: string } | null = null;
		const handler = withUcpRoute<{ id: string }>(
			{ action: "cart.read", scope: "cart.create", resourceId: (p) => p.id },
			async (_req, _auth, params) => {
				receivedParams = params;
				return signedJsonResponse({ ok: true }, { status: 200 });
			},
		);
		const res = await handler(
			new Request("https://store.example/api/ucp/rest/carts/abc", {
				method: "GET",
				headers: { Authorization: "Bearer dev-anything" },
			}),
			{ params: Promise.resolve({ id: "abc" }) },
		);
		expect(res.status).toBe(200);
		expect(receivedParams).toEqual({ id: "abc" });
	});

	it("rate-limits with Retry-After when requests_per_minute is exceeded", async () => {
		devModeEnv();
		// SYNTHETIC_LEGACY_AGENT caps at 30 req/min. Burn through them.
		const handler = withUcpRoute(
			{ action: "catalog.search", scope: "catalog.read" },
			async () => signedJsonResponse({ ok: true }, { status: 200 }),
		);
		for (let i = 0; i < 30; i++) {
			const ok = await handler(bearerRequest({ method: "GET" }));
			expect(ok.status).toBe(200);
		}
		const blocked = await handler(bearerRequest({ method: "GET" }));
		expect(blocked.status).toBe(429);
		expect(blocked.headers.get("Retry-After")).not.toBeNull();
	});

	it("rejects with 429 when computeAmountCents exceeds per-session cap", async () => {
		devModeEnv();
		// SYNTHETIC_LEGACY_AGENT has per_session_cents = 10_000_00 (10 000 USD).
		// Forcing the wrapper to see 11_000_00 must trip the cap before the
		// handler runs.
		let handlerRan = false;
		const handler = withUcpRoute(
			{
				action: "checkout.complete",
				scope: "checkout.complete",
				computeAmountCents: () => 11_000_00,
			},
			async () => {
				handlerRan = true;
				return signedJsonResponse({ ok: true }, { status: 200 });
			},
		);
		const res = await handler(bearerRequest({ body: "{}" }));
		expect(res.status).toBe(429);
		expect(handlerRan).toBe(false);
		const body = (await res.json()) as { error: { code: string; message: string } };
		expect(body.error.code).toBe("rate_limited");
		expect(body.error.message).toMatch(/per-session cap/);
	});

	it("emits an [agent-log] entry on every call with status_code + duration_ms", async () => {
		devModeEnv();
		const handler = withUcpRoute(
			{ action: "cart.create", scope: "cart.create" },
			async () => signedJsonResponse({ ok: true }, { status: 201 }),
		);
		await handler(bearerRequest({ body: '{"variant":"v1"}' }));

		const line = logSpy.mock.calls.find(
			(c: unknown[]) => typeof c[0] === "string" && (c[0] as string).startsWith("[agent-log] "),
		);
		expect(line, "expected an [agent-log] line").toBeDefined();
		const parsed = JSON.parse((line![0] as string).replace("[agent-log] ", "")) as {
			action: string;
			status: string;
			status_code: number;
			duration_ms: number;
		};
		expect(parsed.action).toBe("cart.create");
		expect(parsed.status).toBe("success");
		expect(parsed.status_code).toBe(201);
		expect(parsed.duration_ms).toBeGreaterThanOrEqual(0);
	});
});
