/**
 * Paired-tool registration helper (Phase F3).
 *
 * The spec-blessed mechanism for "iframe sees more than model" is a
 * **hidden tool** — `visibility: ["app"]` removes the tool from
 * `tools/list` while keeping it callable by the iframe via
 * `app.callServerTool`. This helper formalises the convention:
 *
 *   - `model` tool: default visibility `["model", "app"]`, returns the
 *     minimal payload (`public` + `cart-state` per `data-policy.ts`).
 *     This is what the agent sees and what lands in conversation context.
 *
 *   - `app` tool: `visibility: ["app"]`, returns the full payload
 *     including `customer-pii` and `business-confidential` fields.
 *     Iframe calls it via `bridge.fetchAppData("<modelToolName>", args)`,
 *     which appends the `_full` suffix to the model tool name.
 *
 * Both tools share the same `_meta.ui.resourceUri` so the iframe knows
 * which view to render against. The convention is the contract — there
 * is no runtime mapping table.
 *
 * Standalone app-only tools (UI affordances like `update_cart_line` that
 * the agent never needs to discover) don't go through this helper —
 * they call `registerAppTool` directly with `visibility: ["app"]`.
 */

import { type McpUiAppToolConfig } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer, RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mcpAppsEnabled, registerAppTool } from "./feature-flag";

/**
 * Common subset of `registerAppTool` config — drops fields that are
 * fixed by the paired-tool convention (visibility, resourceUri).
 *
 * `inputSchema` / `outputSchema` use `unknown` here because each pair
 * member may have its own shape. Concrete tool registrations pass
 * Zod / Standard-Schema-compatible values; we re-cast at the call site.
 */
export interface PairedToolMember<TConfig = Record<string, unknown>> {
	name: string;
	description: string;
	inputSchema?: TConfig;
	outputSchema?: TConfig;
	handler: McpUiAppToolConfig extends never ? never : unknown;
}

export interface ToolPairConfig {
	/** `ui://saleor/<view>.html` URI advertised by both tools. */
	resourceUri: string;
	/**
	 * Model-facing tool. Appears in `tools/list`; returns minimal payload.
	 * Visibility defaults to `["model", "app"]` (so the iframe can also
	 * read it directly if it wants to skip the paired fetch).
	 */
	model: {
		name: string;
		config: Omit<McpUiAppToolConfig, "_meta"> & {
			_meta?: Omit<Record<string, unknown>, "ui">;
		};
		handler: Parameters<typeof registerAppTool>[3];
	};
	/**
	 * App-only paired tool. Hidden from `tools/list`. Convention: name is
	 * `<model.name>_full`. We don't enforce naming in code — `fetchAppData`
	 * on the client follows the same convention.
	 */
	app: {
		name: string;
		config: Omit<McpUiAppToolConfig, "_meta"> & {
			_meta?: Omit<Record<string, unknown>, "ui">;
		};
		handler: Parameters<typeof registerAppTool>[3];
	};
}

export interface RegisteredToolPair {
	model: RegisteredTool;
	/**
	 * `null` only when `mcpAppsEnabled()` is `false` (Phase F8 feature
	 * flag): without `_meta.ui.visibility = ["app"]` the `_full` sibling
	 * would land in `tools/list` and leak PII, so the helper skips
	 * registering it entirely. Callers don't reference this field today;
	 * the type just makes the contract explicit.
	 */
	app: RegisteredTool | null;
}

/**
 * Register both members of a paired tool. Returns the two handles so
 * tests / dev tooling can enable/disable them individually.
 *
 * The helper enforces:
 *   - Model tool has `_meta.ui.resourceUri` set, NO `visibility` (so the
 *     spec default `["model", "app"]` applies — model can call it).
 *   - App tool has `_meta.ui.resourceUri` matching the model's, plus
 *     `visibility: ["app"]` so it's omitted from `tools/list`.
 *
 * Any other `_meta` keys callers provide are passed through verbatim.
 *
 * When the Apps feature flag is OFF (Phase F8), the model tool still
 * registers — minus its `_meta.ui` — and the `_full` sibling is skipped
 * outright. That keeps `tools/list` clean and the PII-bearing handler
 * permanently unreachable.
 */
export function registerToolPair(
	server: Pick<McpServer, "registerTool">,
	pair: ToolPairConfig,
): RegisteredToolPair {
	const modelConfig = {
		...pair.model.config,
		_meta: {
			...(pair.model.config._meta ?? {}),
			ui: { resourceUri: pair.resourceUri },
		},
	} as McpUiAppToolConfig;

	const modelHandle = registerAppTool(server, pair.model.name, modelConfig, pair.model.handler);

	if (!mcpAppsEnabled()) {
		return { model: modelHandle, app: null };
	}

	const appConfig = {
		...pair.app.config,
		_meta: {
			...(pair.app.config._meta ?? {}),
			ui: { resourceUri: pair.resourceUri, visibility: ["app"] as const },
		},
	} as McpUiAppToolConfig;

	const appHandle = registerAppTool(server, pair.app.name, appConfig, pair.app.handler);

	return { model: modelHandle, app: appHandle };
}

/**
 * Build the conventional app-tool name for a given model-tool name.
 * Mirrors the client-side `fetchAppData` rule. Exported so tests can
 * keep server + client in agreement.
 */
export function pairedAppToolName(modelToolName: string): string {
	return `${modelToolName}_full`;
}
