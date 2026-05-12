/**
 * Content Security Policy allowlists for MCP Apps views (Phase F2).
 *
 * Maps env config to the `McpUiResourceCsp` shape that
 * `@modelcontextprotocol/ext-apps` puts on `_meta.ui.csp`:
 *
 *   - `resourceDomains[]` — origins for images, scripts, styles, fonts,
 *     media. Saleor product images live on the configured Saleor origin
 *     (and an optional media CDN); without the entry the sandboxed
 *     iframe blocks the `<img>` and the view renders blank.
 *   - `connectDomains[]` — origins for fetch/XHR/WebSocket. Empty by
 *     default: iframe code talks back to the MCP server via the host's
 *     postMessage bridge, not direct network. The agent webhook /
 *     Saleor mutations go through the host.
 *
 * Wildcard subdomain syntax is supported per the spec (`https://*.example.com`).
 * Env vars accept comma-separated lists.
 */

import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps";

function originOrNull(url: string | undefined | null): string | null {
	if (!url) return null;
	try {
		return new URL(url).origin;
	} catch {
		return null;
	}
}

function parseList(raw: string | undefined): string[] {
	if (!raw) return [];
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * Build the CSP allowlist for all MCP Apps views.
 *
 * Sources of resource origins (in priority order):
 *   1. `NEXT_PUBLIC_SALEOR_API_URL` — derive the origin (Saleor media is
 *      typically served from the same host as the GraphQL endpoint).
 *   2. `NEXT_PUBLIC_MEDIA_CDN_ORIGIN` — explicit media CDN override.
 *   3. `MCP_APPS_EXTRA_RESOURCE_DOMAINS` — comma-separated escape hatch
 *      for tenant-specific image hosts.
 *
 * Source of connect origins:
 *   1. `MCP_APPS_EXTRA_CONNECT_DOMAINS` — comma-separated. Empty by
 *      default; populate only when a view legitimately needs direct
 *      fetch beyond `tools/call` (rare).
 */
export function buildCsp(): McpUiResourceCsp {
	const resourceDomains: string[] = [];

	const saleorOrigin = originOrNull(process.env.NEXT_PUBLIC_SALEOR_API_URL);
	if (saleorOrigin) resourceDomains.push(saleorOrigin);

	const cdnOrigin = originOrNull(process.env.NEXT_PUBLIC_MEDIA_CDN_ORIGIN);
	if (cdnOrigin && cdnOrigin !== saleorOrigin) resourceDomains.push(cdnOrigin);

	for (const extra of parseList(process.env.MCP_APPS_EXTRA_RESOURCE_DOMAINS)) {
		if (!resourceDomains.includes(extra)) resourceDomains.push(extra);
	}

	const connectDomains = parseList(process.env.MCP_APPS_EXTRA_CONNECT_DOMAINS);

	return { resourceDomains, connectDomains };
}
