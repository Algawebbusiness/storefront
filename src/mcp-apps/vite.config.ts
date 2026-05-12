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

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	root: __dirname,
	plugins: [viteSingleFile({ removeViteModuleLoader: true })],
	esbuild: {
		jsx: "automatic",
		jsxImportSource: "react",
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		assetsInlineLimit: 1_000_000, // inline everything
		cssCodeSplit: false,
		rollupOptions: {
			input: {
				"product-card": resolve(__dirname, "views/product-card.html"),
			},
		},
	},
});
