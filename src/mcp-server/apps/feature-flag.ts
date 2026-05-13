/**
 * MCP Apps feature flag + `registerAppTool` shim (Phase F8).
 *
 * Two responsibilities, one module:
 *
 *   1. `mcpAppsEnabled()` — env-driven on/off switch. Default ON.
 *      Setting `MCP_APPS_ENABLED=false` (or `0`) disables the Apps
 *      surface without ripping the code out — useful as an emergency
 *      rollback if a host crashes on unknown `_meta.ui` fields after a
 *      spec drift.
 *
 *   2. A thin `registerAppTool` shim. When enabled, it forwards to the
 *      upstream helper from `@modelcontextprotocol/ext-apps/server`,
 *      which sets `_meta.ui.resourceUri` for MCP Apps-aware hosts.
 *      When disabled, it calls the raw SDK `server.registerTool` with
 *      `_meta.ui` stripped — the tool keeps the same name, schema, and
 *      handler, so HTTP-direct agents continue to work, but `tools/list`
 *      stops advertising UI resources.
 *
 * Tool responses still pass through `wrapAsData` regardless of the
 * flag, so even when the iframe surface is off, the BEGIN/END delimiter
 * keeps the indirect-prompt-injection defense in place.
 *
 * Callers should import from this module instead of `ext-apps/server`
 * directly — that way the flag-vs-spec behavior stays in one place.
 */

import {
	registerAppTool as upstreamRegisterAppTool,
	type McpUiAppToolConfig,
} from "@modelcontextprotocol/ext-apps/server";

/**
 * Truthy-ON default: missing env var or any non-`false` / non-`0` value
 * leaves the Apps surface enabled. We deliberately do NOT match `1` /
 * `true` and treat everything else as off — backwards-compat with the
 * many storefronts that haven't set the var yet.
 */
export function mcpAppsEnabled(): boolean {
	const raw = process.env.MCP_APPS_ENABLED;
	if (raw === undefined) return true;
	const normalised = raw.trim().toLowerCase();
	return normalised !== "false" && normalised !== "0" && normalised !== "no" && normalised !== "off";
}

/**
 * Drop the `ui` field from a `_meta` object and return whatever else
 * the caller put there (or `undefined` if `ui` was the only key).
 *
 * Caller-provided `_meta` keys (`"io.acme.note"` etc.) survive intact,
 * mirroring the behavior of `registerToolPair` in `paired-tools.ts`.
 */
function stripUiFromMeta(meta: McpUiAppToolConfig["_meta"] | undefined): Record<string, unknown> | undefined {
	if (!meta) return undefined;
	const { ui: _ui, ...rest } = meta as { ui?: unknown; [k: string]: unknown };
	return Object.keys(rest).length > 0 ? rest : undefined;
}

/**
 * Flag-aware `registerAppTool`. Reuses the upstream helper's exact
 * function type so call sites keep their input-schema → handler-args
 * generic inference; the implementation just branches on the env flag.
 */
export const registerAppTool: typeof upstreamRegisterAppTool = (server, name, config, handler) => {
	if (mcpAppsEnabled()) {
		return upstreamRegisterAppTool(server, name, config, handler);
	}

	// Disabled path: strip `_meta.ui` so `tools/list` advertises a plain
	// tool. We keep the rest of `config` (title, description, schemas,
	// non-`ui` `_meta` entries) intact.
	const meta = stripUiFromMeta(config._meta);
	const { _meta: _drop, ...rest } = config;
	const safeConfig = meta !== undefined ? { ...rest, _meta: meta } : rest;
	return server.registerTool(name, safeConfig as never, handler as never);
};
