/**
 * Integration test for /api/ucp/rest/carts routes.
 *
 * Exercises POST /carts (create) through the migrated `withUcpRoute` wrapper
 * with a mocked Saleor backend, asserting that
 *   - the wrapper accepts dev-mode bearer auth,
 *   - the response carries the signed UCP envelope,
 *   - the activity log is emitted with the right action.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSaleorQuery = vi.fn();

vi.mock("@/mcp-server/saleor-client", () => ({
	saleorQuery: (...args: unknown[]) => mockSaleorQuery(...args),
	getDefaultChannel: () => "default-channel",
}));

import { POST as createCart } from "@/app/api/ucp/rest/carts/route";
import { _resetEnvRegistryCache } from "@/lib/protocols/shared/agent-registry";
import { _resetLimitBuckets } from "@/lib/protocols/shared/limits";

function devModeEnv(): void {
	vi.stubEnv("UCP_ENABLED", "true");
	vi.stubEnv("AGENT_API_KEYS", "");
	vi.stubEnv("AGENT_REGISTRY_JSON", "");
	vi.stubEnv("PAYLOAD_API_URL", "");
	vi.stubEnv("APPROVAL_THRESHOLD_CENTS", "");
}

function fakeCheckout(id = "checkout-1") {
	return {
		id,
		email: null,
		channel: { id: "ch", slug: "default-channel" },
		lines: [],
		totalPrice: {
			gross: { amount: 0, currency: "USD" },
			tax: { amount: 0, currency: "USD" },
		},
		subtotalPrice: { gross: { amount: 0, currency: "USD" } },
		shippingPrice: { gross: { amount: 0, currency: "USD" } },
		discount: null,
		shippingAddress: null,
		billingAddress: null,
		deliveryMethod: null,
		shippingMethods: [],
		isShippingRequired: false,
		authorizeStatus: "NONE",
		chargeStatus: "NONE",
		metadata: [],
	};
}

describe("POST /api/ucp/rest/carts (integration)", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		mockSaleorQuery.mockReset();
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		_resetLimitBuckets();
		_resetEnvRegistryCache();
		devModeEnv();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		_resetLimitBuckets();
		_resetEnvRegistryCache();
	});

	it("creates an empty cart and returns a signed UCP envelope", async () => {
		mockSaleorQuery.mockResolvedValueOnce({
			ok: true,
			data: { checkoutCreate: { checkout: fakeCheckout(), errors: [] } },
		});
		// Agent-binding metadata write + refetch (IDOR defense).
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { updateMetadata: { errors: [] } } });
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { checkout: fakeCheckout() } });

		const res = await createCart(
			new Request("https://store.example/api/ucp/rest/carts", {
				method: "POST",
				headers: { Authorization: "Bearer dev-anything", "Content-Type": "application/json" },
				body: "{}",
			}),
		);

		expect(res.status).toBe(201);
		expect(res.headers.get("UCP-Signature")).not.toBeNull();
		const body = (await res.json()) as { ucp: unknown; cart: { id: string; status: string } };
		expect(body.cart.id).toBe("checkout-1");
		expect(body.cart.status).toBe("active");
		expect(body.ucp).toBeTruthy();

		// One agent-log line was emitted for cart.create.
		const line = logSpy.mock.calls.find(
			(c: unknown[]) => typeof c[0] === "string" && (c[0] as string).startsWith("[agent-log] "),
		);
		expect(line, "expected [agent-log] entry").toBeDefined();
		expect(line![0]).toContain('"action":"cart.create"');
		expect(line![0]).toContain('"status_code":201');
	});

	it("returns 404 when UCP_ENABLED=false", async () => {
		vi.stubEnv("UCP_ENABLED", "false");
		const res = await createCart(
			new Request("https://store.example/api/ucp/rest/carts", {
				method: "POST",
				headers: { Authorization: "Bearer dev-anything" },
				body: "{}",
			}),
		);
		expect(res.status).toBe(404);
		expect(mockSaleorQuery).not.toHaveBeenCalled();
	});

	it("returns 401 without auth header", async () => {
		const res = await createCart(
			new Request("https://store.example/api/ucp/rest/carts", {
				method: "POST",
				body: "{}",
			}),
		);
		expect(res.status).toBe(401);
		expect(mockSaleorQuery).not.toHaveBeenCalled();
	});

	it("surfaces Saleor server errors as 500", async () => {
		mockSaleorQuery.mockResolvedValueOnce({ ok: false, error: "boom" });
		const res = await createCart(
			new Request("https://store.example/api/ucp/rest/carts", {
				method: "POST",
				headers: { Authorization: "Bearer dev-anything" },
				body: "{}",
			}),
		);
		expect(res.status).toBe(500);
	});
});
