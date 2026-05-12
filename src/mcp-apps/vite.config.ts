/**
 * Vite config for MCP Apps bundles (Phase F1).
 *
 * Builds each `views/<name>.html` entry into a **single self-contained HTML
 * file** in `dist/`. The MCP server reads these files and serves them as
 * `ui://saleor/<name>.html` resources to MCP Apps-aware hosts (Claude,
 * Copilot, Goose, ...).
 *
 * Why single-file: spec recommends the UI resource ship as one inline
 * blob — CSP gymnastics for hosts that try to fetch external assets is
 * the bigger pain than a slightly larger HTML payload.
 *
 * No `@vitejs/plugin-react` here on purpose — Vite already handles JSX
 * via esbuild, and plugin-react pulls in a Babel chain whose `semver`
 * dep currently lacks provenance attestation (pnpm 10 blocks). Fast
 * Refresh is a dev-mode quality-of-life that we don't need for these
 * static bundles.
 */

import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * vite-plugin-singlefile only supports one entry per build (rollup forbids
 * `inlineDynamicImports` with multi-input). `scripts/build-mcp-apps.mjs`
 * therefore runs vite N times — once per view — passing the view name in
 * the `MCP_APPS_VIEW` env var. This config picks it up and builds just
 * that view into `dist/views/<name>.html`.
 *
 * Building each view independently also yields *true* isolation: a
 * payload type change in one view can't accidentally bundle into another.
 */

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const view = process.env.MCP_APPS_VIEW;
if (!view) {
	throw new Error("MCP_APPS_VIEW env var is required (e.g. 'product-card')");
}

export default defineConfig({
	root: __dirname,
	plugins: [viteSingleFile({ removeViteModuleLoader: true })],
	esbuild: {
		jsx: "automatic",
		jsxImportSource: "react",
	},
	resolve: {
		alias: {
			"@": resolve(__dirname, "../../src"),
		},
	},
	build: {
		outDir: "dist",
		emptyOutDir: false, // build script clears once before the loop
		assetsInlineLimit: 1_000_000,
		cssCodeSplit: false,
		rollupOptions: {
			input: resolve(__dirname, `views/${view}.html`),
		},
	},
});
