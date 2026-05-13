/**
 * Phase F8 — feature flag + paired-tool fallback tests.
 *
 * Covers the two acceptance items that DON'T need a DOM:
 *
 *   1. `mcpAppsEnabled()` honors the `MCP_APPS_ENABLED` env var across
 *      the default-on + explicit-off variants we support.
 *   2. The flag-aware `registerAppTool` shim strips `_meta.ui` when off
 *      while still going through `server.registerTool` (so the tool
 *      itself stays callable). Other `_meta` keys survive.
 *   3. `registerToolPair` skips the `_full` sibling entirely when off
 *      — registering a hidden tool without `visibility:["app"]` would
 *      leak PII back into `tools/list`. Returns `app: null` instead.
 *
 * The bridge handshake-timeout fallback path needs a DOM and is exercised
 * in the manual smoke test plan documented in `docs/mcp-apps-spec-pinning.md`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mcpAppsEnabled, registerAppTool } from "@/mcp-server/apps/feature-flag";
import { registerToolPair } from "@/mcp-server/apps/paired-tools";

interface CapturedRegistration {
	name: string;
	config: {
		_meta?: {
			ui?: { resourceUri?: string; visibility?: readonly string[] };
			[k: string]: unknown;
		};
		[k: string]: unknown;
	};
}

function captureServer() {
	const calls: CapturedRegistration[] = [];
	const server = {
		registerTool: vi.fn((name: string, config: unknown) => {
			calls.push({ name, config: config as CapturedRegistration["config"] });
			return { enable: vi.fn(), disable: vi.fn() };
		}),
	};
	return { server, calls };
}

describe("mcpAppsEnabled", () => {
	const ORIGINAL = process.env.MCP_APPS_ENABLED;
	afterEach(() => {
		if (ORIGINAL === undefined) {
			delete process.env.MCP_APPS_ENABLED;
		} else {
			process.env.MCP_APPS_ENABLED = ORIGINAL;
		}
	});

	it("defaults to enabled when the env var is unset", () => {
		delete process.env.MCP_APPS_ENABLED;
		expect(mcpAppsEnabled()).toBe(true);
	});

	it("stays enabled for any truthy-ish value", () => {
		for (const value of ["true", "1", "yes", "on", "TRUE", " enabled "]) {
			process.env.MCP_APPS_ENABLED = value;
			expect(mcpAppsEnabled()).toBe(true);
		}
	});

	it("disables on the four canonical opt-outs (false / 0 / no / off, case-insensitive)", () => {
		for (const value of ["false", "0", "no", "off", "FALSE", "  Off  "]) {
			process.env.MCP_APPS_ENABLED = value;
			expect(mcpAppsEnabled()).toBe(false);
		}
	});
});

describe("registerAppTool shim — flag-aware _meta.ui injection", () => {
	const ORIGINAL = process.env.MCP_APPS_ENABLED;
	afterEach(() => {
		if (ORIGINAL === undefined) {
			delete process.env.MCP_APPS_ENABLED;
		} else {
			process.env.MCP_APPS_ENABLED = ORIGINAL;
		}
	});

	beforeEach(() => {
		delete process.env.MCP_APPS_ENABLED;
	});

	it("forwards _meta.ui.resourceUri verbatim when the flag is enabled", () => {
		const { server, calls } = captureServer();
		registerAppTool(
			server as never,
			"search_products",
			{
				description: "Search products",
				_meta: { ui: { resourceUri: "ui://saleor/product-list.html" } },
			} as never,
			(() => ({ content: [{ type: "text" as const, text: "" }] })) as never,
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.config._meta?.ui?.resourceUri).toBe("ui://saleor/product-list.html");
	});

	it("strips _meta.ui completely when the flag is disabled", () => {
		process.env.MCP_APPS_ENABLED = "false";
		const { server, calls } = captureServer();
		registerAppTool(
			server as never,
			"search_products",
			{
				description: "Search products",
				_meta: { ui: { resourceUri: "ui://saleor/product-list.html" } },
			} as never,
			(() => ({ content: [{ type: "text" as const, text: "" }] })) as never,
		);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.config._meta?.ui).toBeUndefined();
		// And the tool is still registered (auth-by-default fallback works)
		expect(calls[0]!.name).toBe("search_products");
	});

	it("preserves other _meta keys when stripping ui", () => {
		process.env.MCP_APPS_ENABLED = "0";
		const { server, calls } = captureServer();
		registerAppTool(
			server as never,
			"search_products",
			{
				description: "Search products",
				_meta: {
					ui: { resourceUri: "ui://saleor/product-list.html" },
					"io.acme.note": "hello",
				},
			} as never,
			(() => ({ content: [{ type: "text" as const, text: "" }] })) as never,
		);
		expect(calls[0]!.config._meta?.["io.acme.note"]).toBe("hello");
		expect(calls[0]!.config._meta?.ui).toBeUndefined();
	});

	it("drops the entire _meta key when ui was the only entry", () => {
		process.env.MCP_APPS_ENABLED = "false";
		const { server, calls } = captureServer();
		registerAppTool(
			server as never,
			"search_products",
			{
				description: "Search products",
				_meta: { ui: { resourceUri: "ui://saleor/product-list.html" } },
			} as never,
			(() => ({ content: [{ type: "text" as const, text: "" }] })) as never,
		);
		expect(calls[0]!.config._meta).toBeUndefined();
	});
});

describe("registerToolPair — feature-flag handling", () => {
	const ORIGINAL = process.env.MCP_APPS_ENABLED;
	afterEach(() => {
		if (ORIGINAL === undefined) {
			delete process.env.MCP_APPS_ENABLED;
		} else {
			process.env.MCP_APPS_ENABLED = ORIGINAL;
		}
	});

	it("registers both members when enabled (regression on F3 contract)", () => {
		delete process.env.MCP_APPS_ENABLED;
		const { server, calls } = captureServer();
		const handles = registerToolPair(server as never, {
			resourceUri: "ui://saleor/cart-preview.html",
			model: {
				name: "get_cart",
				config: { description: "Get cart preview" },
				handler: vi.fn() as never,
			},
			app: {
				name: "get_cart_full",
				config: { description: "Get cart preview (full)" },
				handler: vi.fn() as never,
			},
		});
		expect(calls.map((c) => c.name)).toEqual(["get_cart", "get_cart_full"]);
		expect(handles.app).not.toBeNull();
	});

	it("skips the _full sibling and strips _meta.ui from the model when disabled", () => {
		process.env.MCP_APPS_ENABLED = "false";
		const { server, calls } = captureServer();
		const handles = registerToolPair(server as never, {
			resourceUri: "ui://saleor/cart-preview.html",
			model: {
				name: "get_cart",
				config: { description: "Get cart preview" },
				handler: vi.fn() as never,
			},
			app: {
				name: "get_cart_full",
				config: { description: "Get cart preview (full)" },
				handler: vi.fn() as never,
			},
		});
		expect(calls.map((c) => c.name)).toEqual(["get_cart"]);
		expect(calls[0]!.config._meta?.ui).toBeUndefined();
		expect(handles.app).toBeNull();
	});
});
