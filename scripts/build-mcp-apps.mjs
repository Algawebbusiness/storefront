/**
 * Orchestrate the MCP Apps single-file Vite build (Phase F1).
 *
 * Runs `vite build` against `src/mcp-apps/vite.config.ts`, then summarises
 * the output (file count + gzipped byte sizes) so CI / hooks can quickly
 * see whether bundles stay within budget (~250 KB gzipped per the plan).
 *
 * Designed to be called from package.json `prebuild`. Exits non-zero on
 * Vite failure or when no bundles are produced.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpAppsDir = path.join(repoRoot, "src", "mcp-apps");
const distDir = path.join(mcpAppsDir, "dist");

const viteResult = spawnSync(
	"pnpm",
	["exec", "vite", "build", "--config", path.join(mcpAppsDir, "vite.config.ts")],
	{ cwd: repoRoot, stdio: "inherit", shell: false },
);

if (viteResult.status !== 0) {
	console.error(`[build-mcp-apps] vite build failed with exit ${viteResult.status}`);
	process.exit(viteResult.status ?? 1);
}

function walkHtml(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = path.join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...walkHtml(full));
		else if (entry.endsWith(".html")) out.push(full);
	}
	return out;
}

let html = [];
try {
	html = walkHtml(distDir);
} catch (err) {
	console.error(`[build-mcp-apps] dist directory missing: ${err.message}`);
	process.exit(1);
}

if (html.length === 0) {
	console.error("[build-mcp-apps] no .html bundles produced");
	process.exit(1);
}

console.log("\n[build-mcp-apps] bundle report:");
const sizeBudgetKb = 250;
let overBudget = 0;
for (const full of html) {
	const rel = path.relative(distDir, full);
	const raw = statSync(full).size;
	const gz = gzipSync(readFileSync(full)).length;
	const gzKb = gz / 1024;
	const flag = gzKb > sizeBudgetKb ? "  ⚠ OVER BUDGET" : "";
	if (gzKb > sizeBudgetKb) overBudget++;
	console.log(
		`  ${rel.padEnd(36)}  ${(raw / 1024).toFixed(1).padStart(7)} KB  (gz ${gzKb
			.toFixed(1)
			.padStart(6)} KB)${flag}`,
	);
}

if (overBudget > 0) {
	console.warn(`[build-mcp-apps] ${overBudget} bundle(s) exceed ${sizeBudgetKb} KB gzipped budget`);
	// non-fatal in F1 — F4+ tightens via dedicated test
}
