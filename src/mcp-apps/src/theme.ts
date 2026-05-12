/**
 * Tenant theme accessor for MCP Apps views (Phase F2).
 *
 * The MCP server inlines a `<script>window.__BRAND__ = {...}</script>`
 * into every served view *before* the React bundle mounts (see
 * `src/mcp-server/apps/serve-html.ts`), so this snapshot is always
 * available during the first render. The shape matches `brandConfig`
 * from `src/config/brand.ts` so the storefront and MCP Apps stay
 * source-of-truth-consistent.
 *
 * `brand.css` is inlined alongside the script; views consume design
 * tokens via `var(--token-name)` and don't need to import anything
 * from this module to be themed.
 */

import type { brandConfig } from "@/config/brand";

declare global {
	interface Window {
		__BRAND__?: typeof brandConfig;
	}
}

/**
 * The shape view code consumes. Kept structurally compatible with
 * `brandConfig` from `@/config/brand` — if that file grows new fields,
 * views opt in by reading `getBrand().newField` (TS narrows it from the
 * injected `window.__BRAND__` type). Fallback only fills the cross-tenant
 * minimum.
 */
export type BrandSnapshot = {
	siteName: string;
	copyrightHolder: string;
	organizationName: string;
	defaultBrand: string;
	tagline: string;
	description: string;
	logoAriaLabel: string;
	titleTemplate: string;
	logoUrl: string;
	contactPhone: string | null;
	contactEmail: string | null;
};

/**
 * Returns the tenant brand snapshot, or a safe fallback when running
 * outside an MCP host (e.g. unit tests, dev preview of an entry file).
 */
export function getBrand(): BrandSnapshot {
	const injected = typeof window !== "undefined" ? window.__BRAND__ : undefined;
	if (injected) return injected;
	return {
		siteName: "Saleor Store",
		copyrightHolder: "Saleor Store",
		organizationName: "Saleor Store",
		defaultBrand: "Saleor Store",
		tagline: "",
		description: "",
		logoAriaLabel: "Store",
		titleTemplate: "%s",
		logoUrl: "/logo.svg",
		contactPhone: null,
		contactEmail: null,
	};
}
