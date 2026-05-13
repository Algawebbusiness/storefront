/**
 * Orchestrate the MCP Apps single-file Vite build (Phase F1/F2).
 *
 * vite-plugin-singlefile forbids multi-input (a rollup constraint —
 * `inlineDynamicImports` can't coexist with multiple inputs). We work
 * around it by running one Vite build per view, in series, passing the
 * view name as the `MCP_APPS_VIEW` env var; `vite.config.ts` picks it
 * up and builds just that view into `dist/views/<name>.html`.
 *
 * After all views build, report raw + gzipped sizes against the 250 KB
 * per-view budget. Non-fatal warning when exceeded — the dedicated test
 * in F9 will enforce it as a hard check.
 *
 * Designed to be called from `prebuild`. Exits non-zero on any failure.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mcpAppsDir = path.join(repoRoot, "src", "mcp-apps");
const distDir = path.join(mcpAppsDir, "dist");
const viewsDir = path.join(mcpAppsDir, "views");

// Clean once; each per-view build then appends to dist/views/.
rmSync(distDir, { recursive: true, force: true });

const views = readdirSync(viewsDir)
	.filter((f) => f.endsWith(".html"))
	.map((f) => f.replace(/\.html$/, ""))
	.sort();

if (views.length === 0) {
	console.error("[build-mcp-apps] no views found under src/mcp-apps/views/");
	process.exit(1);
}

console.log(`[build-mcp-apps] building ${views.length} view(s): ${views.join(", ")}`);

for (const view of views) {
	const result = spawnSync(
		"pnpm",
		["exec", "vite", "build", "--config", path.join(mcpAppsDir, "vite.config.ts")],
		{
			cwd: repoRoot,
			stdio: "inherit",
			shell: false,
			env: { ...process.env, MCP_APPS_VIEW: view },
		},
	);
	if (result.status !== 0) {
		console.error(`[build-mcp-apps] vite build failed for "${view}" with exit ${result.status}`);
		process.exit(result.status ?? 1);
	}
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
const defaultBudgetKb = 250;
const envBudget = process.env.MCP_APPS_BUNDLE_BUDGET_KB;
const sizeBudgetKb = envBudget ? Number(envBudget) : defaultBudgetKb;
if (Number.isNaN(sizeBudgetKb) || sizeBudgetKb <= 0) {
	console.error(
		`[build-mcp-apps] MCP_APPS_BUNDLE_BUDGET_KB="${envBudget}" is not a positive number; aborting`,
	);
	process.exit(2);
}
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

// Phase F9: hard-enforce the gzipped budget. Override with
// `MCP_APPS_BUNDLE_BUDGET_KB=<n>` if a legitimate need arises (escape
// hatch documented in docs/mcp-apps-readme.md).
if (overBudget > 0) {
	console.error(
		`[build-mcp-apps] ${overBudget} bundle(s) exceed ${sizeBudgetKb} KB gzipped budget — failing the build`,
	);
	console.error(
		`[build-mcp-apps] override via MCP_APPS_BUNDLE_BUDGET_KB=<higher> if intentional; otherwise reduce bundle size`,
	);
	process.exit(1);
}
