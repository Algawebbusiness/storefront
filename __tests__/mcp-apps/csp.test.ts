/**
 * Phase F9 — `buildCsp()` env-permutation coverage.
 *
 * Locks the CSP shape across the three env-driven inputs (Saleor origin,
 * media CDN origin, and the two MCP_APPS_EXTRA_* lists) so a deploy-time
 * misconfiguration doesn't silently blank the iframe `<img>` tags.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCsp } from "@/mcp-server/apps/csp";

const ENV_KEYS = [
	"NEXT_PUBLIC_SALEOR_API_URL",
	"NEXT_PUBLIC_MEDIA_CDN_ORIGIN",
	"MCP_APPS_EXTRA_RESOURCE_DOMAINS",
	"MCP_APPS_EXTRA_CONNECT_DOMAINS",
] as const;

describe("buildCsp", () => {
	const original: Record<string, string | undefined> = {};

	beforeEach(() => {
		for (const k of ENV_KEYS) {
			original[k] = process.env[k];
			delete process.env[k];
		}
	});

	afterEach(() => {
		for (const k of ENV_KEYS) {
			if (original[k] === undefined) delete process.env[k];
			else process.env[k] = original[k];
		}
	});

	it("returns empty arrays when no env is set", () => {
		const csp = buildCsp();
		expect(csp.resourceDomains).toEqual([]);
		expect(csp.connectDomains).toEqual([]);
	});

	it("derives the Saleor origin from NEXT_PUBLIC_SALEOR_API_URL (drops path)", () => {
		process.env.NEXT_PUBLIC_SALEOR_API_URL = "https://store.saleor.cloud/graphql/";
		const csp = buildCsp();
		expect(csp.resourceDomains).toEqual(["https://store.saleor.cloud"]);
	});

	it("adds the media CDN origin when distinct from Saleor", () => {
		process.env.NEXT_PUBLIC_SALEOR_API_URL = "https://store.saleor.cloud/graphql/";
		process.env.NEXT_PUBLIC_MEDIA_CDN_ORIGIN = "https://cdn.example.com";
		const csp = buildCsp();
		expect(csp.resourceDomains).toEqual(["https://store.saleor.cloud", "https://cdn.example.com"]);
	});

	it("dedupes the media CDN origin when it equals the Saleor origin", () => {
		process.env.NEXT_PUBLIC_SALEOR_API_URL = "https://store.saleor.cloud/graphql/";
		process.env.NEXT_PUBLIC_MEDIA_CDN_ORIGIN = "https://store.saleor.cloud";
		const csp = buildCsp();
		expect(csp.resourceDomains).toEqual(["https://store.saleor.cloud"]);
	});

	it("appends MCP_APPS_EXTRA_RESOURCE_DOMAINS (comma-separated, trims)", () => {
		process.env.NEXT_PUBLIC_SALEOR_API_URL = "https://store.saleor.cloud/graphql/";
		process.env.MCP_APPS_EXTRA_RESOURCE_DOMAINS = "https://a.example.com, https://b.example.com ";
		const csp = buildCsp();
		expect(csp.resourceDomains).toEqual([
			"https://store.saleor.cloud",
			"https://a.example.com",
			"https://b.example.com",
		]);
	});

	it("dedupes against existing resourceDomains entries", () => {
		process.env.NEXT_PUBLIC_SALEOR_API_URL = "https://store.saleor.cloud/graphql/";
		process.env.MCP_APPS_EXTRA_RESOURCE_DOMAINS = "https://store.saleor.cloud,https://cdn.example.com";
		const csp = buildCsp();
		expect(csp.resourceDomains).toEqual(["https://store.saleor.cloud", "https://cdn.example.com"]);
	});

	it("populates connectDomains only from MCP_APPS_EXTRA_CONNECT_DOMAINS", () => {
		process.env.MCP_APPS_EXTRA_CONNECT_DOMAINS = "https://api.example.com";
		const csp = buildCsp();
		expect(csp.connectDomains).toEqual(["https://api.example.com"]);
		expect(csp.resourceDomains).toEqual([]);
	});

	it("ignores malformed Saleor URL without throwing", () => {
		process.env.NEXT_PUBLIC_SALEOR_API_URL = "not-a-valid-url";
		const csp = buildCsp();
		expect(csp.resourceDomains).toEqual([]);
	});
});
