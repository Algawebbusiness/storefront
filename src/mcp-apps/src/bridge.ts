/**
 * Thin wrapper around `@modelcontextprotocol/ext-apps` `App` (Phase F2 + F3).
 *
 * Sjednocuje API napříč všemi views — entry souborům stačí
 * `createBridge<MyPayload>("my-view")`, dostanou:
 *
 *   - `onResult(handler)` — registrace na `ui/notifications/tool-result`,
 *     auto-JSON.parse text content do typovaného payloadu.
 *   - `callTool(name, args)` — pošle `tools/call` přes hosta zpět na náš
 *     MCP server. Subject preservation: host re-injektne agent identitu
 *     z původního session, iframe nikdy nedrží api_key / OAuth token
 *     (security boundary).
 *   - `openLink(url)` — `ui/open-link`; otevře URL v novém tabu host
 *     browseru. Používá order receipt na "View order".
 *   - `sendUiMessage(msg)` (F3) — typed-enum varianta `ui/message`. Server-
 *     rendered text z `kind` + IDs, žádný free-form string. Original
 *     `sendMessage(text)` zůstává jen jako escape hatch pro budoucí
 *     non-shopping views — F4+ views ho NEpouží.
 *   - `fetchAppData(modelToolName, args)` (F3) — paired-tool fetcher.
 *     Posílá `tools/call` na `<modelToolName>_full` hidden tool, který
 *     model nemá v `tools/list` (visibility: ["app"]). Vrací plný
 *     payload včetně customer-pii / business-confidential polí.
 *
 * Handshake timeout + ErrorBoundary fallback landují v F8.
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { unwrapAsData } from "@/mcp-server/apps/sanitize";
import { renderUiMessage, type UiMessage } from "./ui-messages";

export interface BridgeHandle<TPayload> {
	/** Subscribe to fresh tool results pushed from the host. */
	onResult: (handler: (payload: TPayload) => void) => void;
	/** Invoke an MCP tool on our server through the host's bridge. */
	callTool: <R = unknown>(name: string, args: Record<string, unknown>) => Promise<R>;
	/** Ask the host to open a URL in the user's browser. */
	openLink: (url: string) => Promise<void>;
	/**
	 * Send a typed UI message — bridge server-renders `kind` + IDs to
	 * a neutral natural-language string before forwarding to the host.
	 * Iframe never controls the resulting text. Use this for any
	 * chat-context comms in F-views.
	 */
	sendUiMessage: (msg: UiMessage) => Promise<void>;
	/**
	 * Fetch the paired app-only tool's full payload for a given model-
	 * facing tool. Convention: `<modelToolName>_full` (matches
	 * `pairedAppToolName` on the server). The app-only tool has
	 * `visibility: ["app"]` and is omitted from `tools/list`, so the
	 * model can't see it exists.
	 */
	fetchAppData: <R = unknown>(modelToolName: string, args: Record<string, unknown>) => Promise<R>;
	/**
	 * Free-form `ui/message`. Available as an escape hatch but F4-F7
	 * acceptance forbids it — use `sendUiMessage` instead.
	 *
	 * @deprecated Use `sendUiMessage(msg)` for any new view code.
	 */
	sendMessage: (text: string) => Promise<void>;
	/** Raw App handle — escape hatch for future view-specific extensions. */
	app: App;
}

export function createBridge<TPayload = unknown>(name: string, version = "1.0.0"): BridgeHandle<TPayload> {
	const app = new App({ name, version });

	// connect() initiates the postMessage handshake (ui/initialize →
	// ui/notifications/initialized). Fire-and-forget; the App class queues
	// subsequent calls until the handshake settles. Handshake timeout +
	// JSON dump fallback are wired up in F8.
	void app.connect();

	return {
		onResult: (handler) => {
			app.ontoolresult = (params) => {
				const textBlock = params.content?.find(
					(c) =>
						typeof (c as { type?: unknown }).type === "string" && (c as { type: string }).type === "text",
				) as { type: "text"; text: string } | undefined;
				if (!textBlock) return;
				// F4+ tool responses are wrapped by `wrapAsData` (BEGIN/END
				// delimiter frame, per threat-model §3). Try unwrap first;
				// fall back to raw text for any future view that opts out.
				const inner = unwrapAsData(textBlock.text) ?? textBlock.text;
				try {
					handler(JSON.parse(inner) as TPayload);
				} catch {
					// Non-JSON content — view-level error handling lives in F8.
				}
			};
		},

		callTool: async <R = unknown>(toolName: string, args: Record<string, unknown>) => {
			const result = await app.callServerTool({ name: toolName, arguments: args });
			return result as unknown as R;
		},

		openLink: async (url: string) => {
			await app.openLink({ url });
		},

		sendUiMessage: async (msg: UiMessage) => {
			await app.sendMessage({
				role: "user",
				content: [{ type: "text", text: renderUiMessage(msg) }],
			});
		},

		fetchAppData: async <R = unknown>(modelToolName: string, args: Record<string, unknown>) => {
			const result = await app.callServerTool({
				name: `${modelToolName}_full`,
				arguments: args,
			});
			return result as unknown as R;
		},

		sendMessage: async (text: string) => {
			await app.sendMessage({
				role: "user",
				content: [{ type: "text", text }],
			});
		},

		app,
	};
}
