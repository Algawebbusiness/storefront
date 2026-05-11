/**
 * Integration test for /api/ucp/rest/catalog/search.
 *
 * Smoke-tests the cosmetic catalog migration: scope guard, mocked Saleor
 * response, signed envelope.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSaleorQuery = vi.fn();

vi.mock("@/mcp-server/saleor-client", () => ({
	saleorQuery: (...args: unknown[]) => mockSaleorQuery(...args),
	getDefaultChannel: () => "default-channel",
}));

import { GET as searchCatalog } from "@/app/api/ucp/rest/catalog/search/route";
import { _resetEnvRegistryCache } from "@/lib/protocols/shared/agent-registry";
import { _resetLimitBuckets } from "@/lib/protocols/shared/limits";

function devModeEnv(): void {
	vi.stubEnv("UCP_ENABLED", "true");
	vi.stubEnv("AGENT_API_KEYS", "");
	vi.stubEnv("AGENT_REGISTRY_JSON", "");
	vi.stubEnv("PAYLOAD_API_URL", "");
}

function fakeCatalogProduct(slug: string) {
	return {
		id: `prod_${slug}`,
		name: `Product ${slug}`,
		slug,
		description: null,
		isAvailable: true,
		isAvailableForPurchase: true,
		category: { id: "cat_1", name: "Cat", slug: "cat" },
		pricing: {
			priceRange: {
				start: { gross: { amount: 10, currency: "USD" } },
				stop: { gross: { amount: 10, currency: "USD" } },
			},
		},
		media: [],
		defaultVariant: { id: "v_1", sku: null },
		variants: [],
		attributes: [],
	};
}

describe("GET /api/ucp/rest/catalog/search (integration)", () => {
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

	it("returns search hits with a signed UCP envelope", async () => {
		mockSaleorQuery.mockResolvedValueOnce({
			ok: true,
			data: {
				products: {
					totalCount: 1,
					pageInfo: { hasNextPage: false, endCursor: null },
					edges: [{ node: fakeCatalogProduct("foo") }],
				},
			},
		});

		const res = await searchCatalog(
			new Request("https://store.example/api/ucp/rest/catalog/search?q=foo", {
				method: "GET",
				headers: { Authorization: "Bearer dev-anything" },
			}),
		);

		expect(res.status).toBe(200);
		expect(res.headers.get("UCP-Signature")).not.toBeNull();
		const body = (await res.json()) as {
			items: Array<{ id: string; title: string; url: string }>;
			total_count: number;
		};
		expect(body.total_count).toBe(1);
		expect(body.items).toHaveLength(1);
		expect(body.items[0]!.id).toBe("prod_foo");
		expect(body.items[0]!.url).toContain("/products/foo");
	});

	it("returns 400 on invalid limit", async () => {
		const res = await searchCatalog(
			new Request("https://store.example/api/ucp/rest/catalog/search?limit=9999", {
				method: "GET",
				headers: { Authorization: "Bearer dev-anything" },
			}),
		);
		expect(res.status).toBe(400);
		expect(mockSaleorQuery).not.toHaveBeenCalled();
	});
});
