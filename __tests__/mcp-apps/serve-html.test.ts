/**
 * Phase F2 — serve-html theme injection + CSP allowlist tests.
 *
 * Verifies:
 *   - Every entry in APP_RESOURCES resolves to a built bundle on disk.
 *   - loadThemedView injects `<style id="brand-tokens">` and a
 *     `window.__BRAND__ =` script BEFORE `</head>`, so React mounts see
 *     the brand snapshot on first render.
 *   - The cached theme'd HTML is re-served identically (memo hit).
 *   - `_resetServeHtmlCache()` forces a fresh read.
 *   - buildCsp derives resource origins from env and dedupes Saleor+CDN
 *     when they share an origin.
 *
 * These tests run against the F2 stub bundles built by `pnpm run
 * build:mcp-apps`. They don't assert bundle content (that's F4+); they
 * only check the wrapper layer.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APP_RESOURCES } from "@/mcp-server/apps/registry";
import { _resetServeHtmlCache, loadThemedView, loadThemedViewByKey } from "@/mcp-server/apps/serve-html";
import { buildCsp } from "@/mcp-server/apps/csp";

const DIST = path.join(process.cwd(), "src", "mcp-apps", "dist");

describe("APP_RESOURCES registry", () => {
	it("has a bundle file on disk for every registered key", () => {
		for (const res of Object.values(APP_RESOURCES)) {
			const full = path.join(DIST, res.bundle);
			expect(existsSync(full), `${res.bundle} missing — run pnpm run build:mcp-apps`).toBe(true);
		}
	});

	it("URIs use the ui://saleor namespace", () => {
		for (const res of Object.values(APP_RESOURCES)) {
			expect(res.uri).toMatch(/^ui:\/\/saleor\/[a-z-]+\.html$/);
		}
	});
});

describe("loadThemedView", () => {
	beforeEach(() => _resetServeHtmlCache());
	afterEach(() => _resetServeHtmlCache());

	it("injects brand tokens style block + __BRAND__ script before </head>", async () => {
		const html = await loadThemedView(APP_RESOURCES.productCard.bundle);
		const styleIdx = html.indexOf('<style id="brand-tokens">');
		const brandIdx = html.indexOf("window.__BRAND__ =");
		const closeHead = html.indexOf("</head>");
		expect(styleIdx).toBeGreaterThan(0);
		expect(brandIdx).toBeGreaterThan(styleIdx);
		expect(closeHead).toBeGreaterThan(brandIdx);
	});

	it("inlines a JSON-serialised brandConfig snapshot", async () => {
		const html = await loadThemedView(APP_RESOURCES.productCard.bundle);
		const match = html.match(/window\.__BRAND__ = ({[^<]+});/);
		expect(match).not.toBeNull();
		const parsed = JSON.parse(match![1]!) as { siteName: string };
		expect(parsed.siteName).toBeTypeOf("string");
		expect(parsed.siteName.length).toBeGreaterThan(0);
	});

	it("escapes </ sequences in the brand JSON to prevent script breakage", async () => {
		const html = await loadThemedView(APP_RESOURCES.productCard.bundle);
		// Allowed:  < (escaped)   Disallowed: literal `</` inside the script body.
		const scriptStart = html.indexOf("window.__BRAND__ =");
		const scriptEnd = html.indexOf("</script>", scriptStart);
		const body = html.slice(scriptStart, scriptEnd);
		expect(body).not.toContain("</");
	});

	it("memoizes the assembled HTML — repeat calls return the same instance", async () => {
		const a = await loadThemedView(APP_RESOURCES.productCard.bundle);
		const b = await loadThemedView(APP_RESOURCES.productCard.bundle);
		expect(a).toBe(b);
	});

	it("loadThemedViewByKey resolves through the registry", async () => {
		const byKey = await loadThemedViewByKey("productList");
		const byBundle = await loadThemedView(APP_RESOURCES.productList.bundle);
		expect(byKey).toBe(byBundle);
	});
});

describe("buildCsp", () => {
	afterEach(() => vi.unstubAllEnvs());

	it("derives a single resourceDomain from NEXT_PUBLIC_SALEOR_API_URL", () => {
		vi.stubEnv("NEXT_PUBLIC_SALEOR_API_URL", "https://saleor.example.com/graphql/");
		vi.stubEnv("NEXT_PUBLIC_MEDIA_CDN_ORIGIN", "");
		vi.stubEnv("MCP_APPS_EXTRA_RESOURCE_DOMAINS", "");
		const csp = buildCsp();
		expect(csp.resourceDomains).toEqual(["https://saleor.example.com"]);
		expect(csp.connectDomains).toEqual([]);
	});

	it("adds the media CDN origin when distinct from Saleor", () => {
		vi.stubEnv("NEXT_PUBLIC_SALEOR_API_URL", "https://saleor.example.com/graphql/");
		vi.stubEnv("NEXT_PUBLIC_MEDIA_CDN_ORIGIN", "https://cdn.example.com");
		const csp = buildCsp();
		expect(csp.resourceDomains).toEqual(["https://saleor.example.com", "https://cdn.example.com"]);
	});

	it("dedupes media CDN when it shares Saleor's origin", () => {
		vi.stubEnv("NEXT_PUBLIC_SALEOR_API_URL", "https://saleor.example.com/graphql/");
		vi.stubEnv("NEXT_PUBLIC_MEDIA_CDN_ORIGIN", "https://saleor.example.com");
		const csp = buildCsp();
		expect(csp.resourceDomains).toEqual(["https://saleor.example.com"]);
	});

	it("appends MCP_APPS_EXTRA_RESOURCE_DOMAINS verbatim, deduped", () => {
		vi.stubEnv("NEXT_PUBLIC_SALEOR_API_URL", "https://saleor.example.com/graphql/");
		vi.stubEnv("MCP_APPS_EXTRA_RESOURCE_DOMAINS", "https://images.tenant.cz, https://saleor.example.com");
		const csp = buildCsp();
		expect(csp.resourceDomains).toEqual(["https://saleor.example.com", "https://images.tenant.cz"]);
	});

	it("populates connectDomains from MCP_APPS_EXTRA_CONNECT_DOMAINS", () => {
		vi.stubEnv("NEXT_PUBLIC_SALEOR_API_URL", "");
		vi.stubEnv("MCP_APPS_EXTRA_CONNECT_DOMAINS", "wss://realtime.example.com,https://api.example.com");
		const csp = buildCsp();
		expect(csp.connectDomains).toEqual(["wss://realtime.example.com", "https://api.example.com"]);
	});

	it("returns empty allowlists when nothing is configured", () => {
		vi.stubEnv("NEXT_PUBLIC_SALEOR_API_URL", "");
		vi.stubEnv("NEXT_PUBLIC_MEDIA_CDN_ORIGIN", "");
		vi.stubEnv("MCP_APPS_EXTRA_RESOURCE_DOMAINS", "");
		vi.stubEnv("MCP_APPS_EXTRA_CONNECT_DOMAINS", "");
		const csp = buildCsp();
		expect(csp.resourceDomains).toEqual([]);
		expect(csp.connectDomains).toEqual([]);
	});
});
