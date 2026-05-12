/**
 * MCP Apps server-side wiring (Phase F2).
 *
 * `registerAllAppResources(server)` registers every entry in
 * `APP_RESOURCES` with the MCP server as a `ui://` resource, using the
 * `@modelcontextprotocol/ext-apps` helper. Each resource:
 *
 *   - Advertises MIME type `text/html;profile=mcp-app` (the constant
 *     `RESOURCE_MIME_TYPE` exported by `ext-apps/server`).
 *   - Carries `_meta.ui.csp` so the host's sandboxed iframe can load
 *     Saleor product images / media-CDN assets. The CSP is built from
 *     env (`NEXT_PUBLIC_SALEOR_API_URL`, `NEXT_PUBLIC_MEDIA_CDN_ORIGIN`,
 *     `MCP_APPS_EXTRA_*`) at request time so deploy reconfig propagates
 *     without rebuilding bundles.
 *   - Serves the themed HTML through `loadThemedView()`, which inlines
 *     `brand.css` tokens + a `window.__BRAND__` snapshot of `brandConfig`.
 *
 * Read callback signature follows `McpUiReadResourceCallback`:
 * `(uri, extra) => { contents: [...] }`. The `uri` is a `URL` object
 * for which the host registered listening — we just echo it back on
 * the resource entry.
 */

import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildCsp } from "./csp";
import { APP_RESOURCES, type AppResource } from "./registry";
import { loadThemedView } from "./serve-html";

export function registerAllAppResources(server: McpServer): void {
	for (const resource of Object.values(APP_RESOURCES) as AppResource[]) {
		registerAppResource(
			server,
			resource.name,
			resource.uri,
			{
				description: `${resource.name} (Saleor MCP Apps view)`,
				mimeType: RESOURCE_MIME_TYPE,
				_meta: { ui: { csp: buildCsp() } },
			},
			async (uri) => {
				const text = await loadThemedView(resource.bundle);
				return {
					contents: [
						{
							uri: uri.toString(),
							mimeType: RESOURCE_MIME_TYPE,
							text,
							_meta: { ui: { csp: buildCsp() } },
						},
					],
				};
			},
		);
	}
}
