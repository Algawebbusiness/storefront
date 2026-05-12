/**
 * Phase F3 — paired-tool registration tests.
 *
 * Verifies the spec-blessed mechanism: model-facing tool has default
 * visibility (so it appears in `tools/list`), paired app-only tool has
 * `visibility: ["app"]` (omitted from `tools/list`). Both share the
 * same `_meta.ui.resourceUri`.
 *
 * The tests use a mock `McpServer` (only `registerTool` matters) so we
 * don't spin up the real SDK — we just want to assert what registerAppTool
 * forwards into the server given our paired-tool helper's transformation.
 */

import { describe, expect, it, vi } from "vitest";
import { pairedAppToolName, registerToolPair } from "@/mcp-server/apps/paired-tools";

interface CapturedRegistration {
	name: string;
	config: {
		_meta?: {
			ui?: {
				resourceUri?: string;
				visibility?: readonly string[];
			};
			[k: string]: unknown;
		};
		[k: string]: unknown;
	};
}

function mockServer() {
	const calls: CapturedRegistration[] = [];
	const server = {
		registerTool: vi.fn((name: string, config: unknown, _handler: unknown) => {
			calls.push({ name, config } as CapturedRegistration);
			return { enable: vi.fn(), disable: vi.fn() };
		}),
	};
	return { server, calls };
}

describe("registerToolPair", () => {
	it("registers two tools: model-visible + app-only", () => {
		const { server, calls } = mockServer();

		registerToolPair(server as never, {
			resourceUri: "ui://saleor/cart-preview.html",
			model: {
				name: "get_cart",
				config: { description: "Get cart summary" },
				handler: vi.fn() as never,
			},
			app: {
				name: pairedAppToolName("get_cart"),
				config: { description: "Get cart full payload (app-only)" },
				handler: vi.fn() as never,
			},
		});

		expect(server.registerTool).toHaveBeenCalledTimes(2);
		expect(calls.map((c) => c.name)).toEqual(["get_cart", "get_cart_full"]);
	});

	it("model tool has _meta.ui.resourceUri but NO visibility override (default = both)", () => {
		const { server, calls } = mockServer();
		registerToolPair(server as never, {
			resourceUri: "ui://saleor/cart-preview.html",
			model: {
				name: "get_cart",
				config: { description: "x" },
				handler: vi.fn() as never,
			},
			app: {
				name: "get_cart_full",
				config: { description: "y" },
				handler: vi.fn() as never,
			},
		});

		const modelCall = calls.find((c) => c.name === "get_cart")!;
		expect(modelCall.config._meta?.ui?.resourceUri).toBe("ui://saleor/cart-preview.html");
		expect(modelCall.config._meta?.ui?.visibility).toBeUndefined();
	});

	it("app tool has visibility: ['app'] — hidden from tools/list", () => {
		const { server, calls } = mockServer();
		registerToolPair(server as never, {
			resourceUri: "ui://saleor/cart-preview.html",
			model: {
				name: "get_cart",
				config: { description: "x" },
				handler: vi.fn() as never,
			},
			app: {
				name: "get_cart_full",
				config: { description: "y" },
				handler: vi.fn() as never,
			},
		});

		const appCall = calls.find((c) => c.name === "get_cart_full")!;
		expect(appCall.config._meta?.ui?.visibility).toEqual(["app"]);
	});

	it("both tools share the same resourceUri", () => {
		const { server, calls } = mockServer();
		registerToolPair(server as never, {
			resourceUri: "ui://saleor/checkout-summary.html",
			model: {
				name: "get_checkout",
				config: { description: "x" },
				handler: vi.fn() as never,
			},
			app: {
				name: "get_checkout_full",
				config: { description: "y" },
				handler: vi.fn() as never,
			},
		});
		expect(calls[0]!.config._meta?.ui?.resourceUri).toBe("ui://saleor/checkout-summary.html");
		expect(calls[1]!.config._meta?.ui?.resourceUri).toBe("ui://saleor/checkout-summary.html");
	});

	it("preserves caller-supplied _meta keys other than `ui`", () => {
		const { server, calls } = mockServer();
		registerToolPair(server as never, {
			resourceUri: "ui://saleor/x.html",
			model: {
				name: "m",
				config: { description: "x", _meta: { "io.acme.note": "hello" } },
				handler: vi.fn() as never,
			},
			app: {
				name: "m_full",
				config: { description: "y", _meta: { "io.acme.note": "world" } },
				handler: vi.fn() as never,
			},
		});

		expect(calls[0]!.config._meta?.["io.acme.note"]).toBe("hello");
		expect(calls[1]!.config._meta?.["io.acme.note"]).toBe("world");
	});
});

describe("pairedAppToolName", () => {
	it("appends `_full` to the model tool name", () => {
		expect(pairedAppToolName("get_cart")).toBe("get_cart_full");
		expect(pairedAppToolName("get_checkout")).toBe("get_checkout_full");
		expect(pairedAppToolName("get_order")).toBe("get_order_full");
	});
});
