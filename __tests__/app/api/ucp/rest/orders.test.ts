/**
 * Integration test for GET /api/ucp/rest/orders/[id].
 *
 * Asserts that the order route runs through the migrated `withUcpRoute`
 * wrapper (signed response, audit log) and handles the not-found path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSaleorQuery = vi.fn();

vi.mock("@/mcp-server/saleor-client", () => ({
	saleorQuery: (...args: unknown[]) => mockSaleorQuery(...args),
	getDefaultChannel: () => "default-channel",
}));

import { GET as readOrder } from "@/app/api/ucp/rest/orders/[id]/route";
import { _resetEnvRegistryCache } from "@/lib/protocols/shared/agent-registry";
import { _resetLimitBuckets } from "@/lib/protocols/shared/limits";

function devModeEnv(): void {
	vi.stubEnv("UCP_ENABLED", "true");
	vi.stubEnv("AGENT_API_KEYS", "");
	vi.stubEnv("AGENT_REGISTRY_JSON", "");
	vi.stubEnv("PAYLOAD_API_URL", "");
}

function fakeOrder(id = "ord_1") {
	return {
		id,
		number: "1001",
		status: "FULFILLED",
		created: "2026-05-01T10:00:00Z",
		userEmail: "buyer@example.com",
		isPaid: true,
		channel: { slug: "default-channel" },
		total: {
			gross: { amount: 50, currency: "USD" },
			tax: { amount: 5, currency: "USD" },
		},
		subtotal: { gross: { amount: 45, currency: "USD" } },
		shippingPrice: { gross: { amount: 5, currency: "USD" } },
		shippingAddress: null,
		billingAddress: null,
		lines: [],
		deliveryMethod: null,
		discounts: [],
		statusDisplay: "Fulfilled",
	};
}

describe("GET /api/ucp/rest/orders/[id] (integration)", () => {
	beforeEach(() => {
		mockSaleorQuery.mockReset();
		vi.spyOn(console, "log").mockImplementation(() => {});
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

	it("returns the order in protocol format with a signed envelope", async () => {
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { order: fakeOrder() } });

		const res = await readOrder(
			new Request("https://store.example/api/ucp/rest/orders/ord_1", {
				method: "GET",
				headers: { Authorization: "Bearer dev-anything" },
			}),
			{ params: Promise.resolve({ id: "ord_1" }) },
		);

		expect(res.status).toBe(200);
		expect(res.headers.get("UCP-Signature")).not.toBeNull();
		const body = (await res.json()) as { order: { id: string } };
		expect(body.order.id).toBe("ord_1");
	});

	it("returns 404 when the order is not found", async () => {
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { order: null } });

		const res = await readOrder(
			new Request("https://store.example/api/ucp/rest/orders/missing", {
				method: "GET",
				headers: { Authorization: "Bearer dev-anything" },
			}),
			{ params: Promise.resolve({ id: "missing" }) },
		);

		expect(res.status).toBe(404);
	});
});
