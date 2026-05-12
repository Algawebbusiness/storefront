/**
 * MCP Apps view loader + tenant theme injection (Phase F2).
 *
 * Reads a built view bundle from `src/mcp-apps/dist/<bundle>`, prepends
 * the tenant theme block (`brand.css` design tokens + a JSON-serialised
 * `window.__BRAND__` from `brandConfig`), and returns the assembled HTML
 * for the MCP Apps `resources/read` callback.
 *
 * Caching strategy:
 *   - The raw bundle is read **once at module load** (top-level `await`
 *     in `init()`) into an in-memory map. Edge runtimes can't call
 *     `fs.readFile` per request, and Node runtimes shouldn't burn syscalls
 *     on a static file 100×/s.
 *   - The themed HTML is also cached, keyed by `bundle`. `brandConfig` is
 *     a module-level constant — until per-tenant runtime branding lands
 *     in Phase E, one assembled HTML per view is the right cardinality.
 *   - Tests can call `_resetServeHtmlCache()` to force a re-read.
 *
 * No fallback on read failure: if a bundle file is missing the function
 * throws, which surfaces as a 500 in the MCP HTTP transport. That's
 * intentional — silently serving an empty `ui://` resource would
 * confuse the host.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { brandConfig } from "@/config/brand";
import { APP_RESOURCES, type AppResourceKey } from "./registry";

const themedCache = new Map<string, string>();
let brandCss: string | null = null;
let initPromise: Promise<void> | null = null;

const DIST_ROOT = path.join(process.cwd(), "src", "mcp-apps", "dist");
const BRAND_CSS_PATH = path.join(process.cwd(), "src", "styles", "brand.css");

async function init(): Promise<void> {
	if (brandCss !== null) return;
	brandCss = await readFile(BRAND_CSS_PATH, "utf-8");
}

function ensureInit(): Promise<void> {
	if (initPromise === null) initPromise = init();
	return initPromise;
}

/**
 * Build the `<head>`-prepended theme block: brand CSS inlined + the
 * `brandConfig` snapshot exposed to iframe JS as `window.__BRAND__`.
 *
 * Ordering matters: the `<script>` runs synchronously before the bundle
 * mounts, so React components can read `window.__BRAND__` during their
 * first render.
 */
function themeBlock(): string {
	const safeBrand = JSON.stringify(brandConfig).replace(/</g, "\\u003c");
	return [
		`<style id="brand-tokens">${brandCss ?? ""}</style>`,
		`<script>window.__BRAND__ = ${safeBrand};</script>`,
	].join("\n");
}

/**
 * Load and theme a built view bundle. Returns the assembled HTML string.
 *
 * @param bundle  Path under `src/mcp-apps/dist/` (e.g. `views/product-card.html`).
 */
export async function loadThemedView(bundle: string): Promise<string> {
	await ensureInit();
	const cached = themedCache.get(bundle);
	if (cached !== undefined) return cached;

	const full = path.join(DIST_ROOT, bundle);
	const raw = await readFile(full, "utf-8");
	const themed = raw.includes("</head>")
		? raw.replace("</head>", `${themeBlock()}</head>`)
		: `${themeBlock()}\n${raw}`;
	themedCache.set(bundle, themed);
	return themed;
}

/** Convenience: load by resource key from `APP_RESOURCES`. */
export async function loadThemedViewByKey(key: AppResourceKey): Promise<string> {
	return loadThemedView(APP_RESOURCES[key].bundle);
}

/** Test helper — clears all caches so the next call re-reads from disk. */
export function _resetServeHtmlCache(): void {
	themedCache.clear();
	brandCss = null;
	initPromise = null;
}
