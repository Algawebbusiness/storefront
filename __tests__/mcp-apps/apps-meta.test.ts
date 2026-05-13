/**
 * Phase F4 — catalog tools `_meta.ui` wiring + wrapAsData isolation.
 *
 * Verifies the deltas from F4:
 *
 *   1. `search_products` and `get_category_products` carry the
 *      `_meta.ui.resourceUri = "ui://saleor/product-list.html"` pointer
 *      so MCP Apps-aware hosts know which view to render.
 *   2. `get_collections` (scope-deferred per CLAUDE.md §4.5 F4 decision
 *      point) stays as a plain JSON tool — no `_meta.ui` until a future
 *      "collection" view ships.
 *   3. Every model-visible payload that DOES carry a `ui://` resource is
 *      wrapped in BEGIN/END delimiters by `wrapAsData` (threat-model §3
 *      defense against indirect prompt injection).
 *
 * Test strategy mirrors `paired-tools.test.ts`: a stub server captures
 * `registerTool`/`tool` calls without booting the real MCP SDK. The
 * `saleor-client` is module-mocked so we can drive each handler with a
 * controlled GraphQL response and inspect the wrapped text content.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/mcp-server/saleor-client", () => ({
	getDefaultChannel: () => "default-channel",
	saleorQuery: vi.fn(),
}));

import { saleorQuery } from "@/mcp-server/saleor-client";
import { registerSearchTools } from "@/mcp-server/tools/search";
import { registerCategoryTools } from "@/mcp-server/tools/categories";
import { registerCollectionTools } from "@/mcp-server/tools/collections";

interface CapturedCall {
	method: "tool" | "registerTool";
	name: string;
	config: {
		description?: string;
		inputSchema?: unknown;
		_meta?: {
			ui?: { resourceUri?: string; visibility?: readonly string[] };
			[k: string]: unknown;
		};
		[k: string]: unknown;
	};
	handler: (
		args: Record<string, unknown>,
		extra?: unknown,
	) => Promise<{
		content: Array<{ type: "text"; text: string }>;
	}>;
}

function createCapturingServer() {
	const calls: CapturedCall[] = [];
	const server = {
		tool: vi.fn(
			(name: string, description: string, inputSchema: unknown, handler: CapturedCall["handler"]) => {
				calls.push({ method: "tool", name, config: { description, inputSchema }, handler });
				return { enable: vi.fn(), disable: vi.fn() };
			},
		),
		registerTool: vi.fn((name: string, config: CapturedCall["config"], handler: CapturedCall["handler"]) => {
			calls.push({ method: "registerTool", name, config, handler });
			return { enable: vi.fn(), disable: vi.fn() };
		}),
	};
	return { server, calls };
}

describe("F4 catalog tools — _meta.ui wiring", () => {
	beforeEach(() => {
		vi.mocked(saleorQuery).mockReset();
	});

	it("search_products advertises ui://saleor/product-list.html", () => {
		const { server, calls } = createCapturingServer();
		registerSearchTools(server as never);

		const entry = calls.find((c) => c.name === "search_products");
		expect(entry).toBeDefined();
		expect(entry!.method).toBe("registerTool");
		expect(entry!.config._meta?.ui?.resourceUri).toBe("ui://saleor/product-list.html");
	});

	it("get_category_products advertises ui://saleor/product-list.html", () => {
		const { server, calls } = createCapturingServer();
		registerCategoryTools(server as never);

		const entry = calls.find((c) => c.name === "get_category_products");
		expect(entry).toBeDefined();
		expect(entry!.method).toBe("registerTool");
		expect(entry!.config._meta?.ui?.resourceUri).toBe("ui://saleor/product-list.html");
	});

	it("list_categories stays a plain tool (no _meta.ui — list view is F-later)", () => {
		const { server, calls } = createCapturingServer();
		registerCategoryTools(server as never);

		const entry = calls.find((c) => c.name === "list_categories");
		expect(entry).toBeDefined();
		expect(entry!.method).toBe("tool");
		expect(entry!.config._meta?.ui).toBeUndefined();
	});

	it("get_collections stays a plain tool (deferred per F4 scope decision)", () => {
		const { server, calls } = createCapturingServer();
		registerCollectionTools(server as never);

		const entry = calls.find((c) => c.name === "get_collections");
		expect(entry).toBeDefined();
		expect(entry!.method).toBe("tool");
		expect(entry!.config._meta?.ui).toBeUndefined();
	});

	it("catalog tools wired to a view have NO paired _full sibling (catalog is `public` class)", () => {
		const { server, calls } = createCapturingServer();
		registerSearchTools(server as never);
		registerCategoryTools(server as never);
		registerCollectionTools(server as never);

		expect(calls.find((c) => c.name === "search_products_full")).toBeUndefined();
		expect(calls.find((c) => c.name === "get_category_products_full")).toBeUndefined();
		expect(calls.find((c) => c.name === "get_collections_full")).toBeUndefined();
	});
});

describe("F4 catalog tools — wrapAsData delimiter on text content", () => {
	beforeEach(() => {
		vi.mocked(saleorQuery).mockReset();
	});

	it("search_products wraps the JSON payload in === BEGIN PRODUCT-LIST ... === END PRODUCT-LIST ===", async () => {
		vi.mocked(saleorQuery).mockResolvedValueOnce({
			ok: true,
			data: {
				products: {
					totalCount: 1,
					edges: [
						{
							node: {
								id: "p1",
								name: "Cosmic Mug",
								slug: "cosmic-mug",
								isAvailable: true,
								category: { name: "Mugs", slug: "mugs" },
								pricing: {
									priceRange: {
										start: { gross: { amount: 9.99, currency: "USD" } },
										stop: { gross: { amount: 9.99, currency: "USD" } },
									},
								},
								thumbnail: { url: "https://cdn.example/p1.webp", alt: null },
							},
						},
					],
				},
			},
		});

		const { server, calls } = createCapturingServer();
		registerSearchTools(server as never);
		const entry = calls.find((c) => c.name === "search_products")!;
		const result = await entry.handler({ query: "mug", first: 10, channel: "default-channel" });
		const text = result.content[0]!.text;

		expect(text.startsWith("=== BEGIN PRODUCT-LIST (")).toBe(true);
		expect(text.trim().endsWith("=== END PRODUCT-LIST ===")).toBe(true);
		// Inner JSON is parseable + has the expected shape
		const inner = text
			.replace(/^=== BEGIN PRODUCT-LIST [^\n]*\n/, "")
			.replace(/\n=== END PRODUCT-LIST ===$/, "");
		const parsed = JSON.parse(inner) as { totalCount: number; products: Array<{ slug: string }> };
		expect(parsed.totalCount).toBe(1);
		expect(parsed.products[0]!.slug).toBe("cosmic-mug");
	});

	it("get_category_products wraps the JSON payload with PRODUCT-LIST delimiters", async () => {
		vi.mocked(saleorQuery).mockResolvedValueOnce({
			ok: true,
			data: {
				category: {
					name: "Mugs",
					slug: "mugs",
					description: null,
					products: {
						totalCount: 0,
						edges: [],
					},
				},
			},
		});

		const { server, calls } = createCapturingServer();
		registerCategoryTools(server as never);
		const entry = calls.find((c) => c.name === "get_category_products")!;
		const result = await entry.handler({ categorySlug: "mugs", first: 10, channel: "default-channel" });
		const text = result.content[0]!.text;

		expect(text).toContain("=== BEGIN PRODUCT-LIST");
		expect(text).toContain("=== END PRODUCT-LIST ===");
	});

	it("get_category_products surfaces a plain 'not found' string when the category is missing (no wrapping)", async () => {
		vi.mocked(saleorQuery).mockResolvedValueOnce({
			ok: true,
			data: { category: null },
		});

		const { server, calls } = createCapturingServer();
		registerCategoryTools(server as never);
		const entry = calls.find((c) => c.name === "get_category_products")!;
		const result = await entry.handler({ categorySlug: "nope", first: 10, channel: "default-channel" });
		expect(result.content[0]!.text).toBe("Category not found");
	});
});
