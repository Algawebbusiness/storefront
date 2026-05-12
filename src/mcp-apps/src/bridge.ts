/**
 * Thin wrapper around `@modelcontextprotocol/ext-apps` `App` (Phase F2).
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
 *   - `sendMessage(text)` — `ui/message`; pošle zprávu do chat / LLM
 *     contextu. F3 přidá typed-enum wrapper aby se předešlo PII úniku.
 *
 * Handshake timeout, ErrorBoundary fallback a typed-enum sendMessage
 * landují v F3 (security policy) / F8 (fallback strategy); F2 ships
 * jen základní bridge.
 */

import { App } from "@modelcontextprotocol/ext-apps";

export interface BridgeHandle<TPayload> {
	/** Subscribe to fresh tool results pushed from the host. */
	onResult: (handler: (payload: TPayload) => void) => void;
	/** Invoke an MCP tool on our server through the host's bridge. */
	callTool: <R = unknown>(name: string, args: Record<string, unknown>) => Promise<R>;
	/** Ask the host to open a URL in the user's browser. */
	openLink: (url: string) => Promise<void>;
	/** Send a chat message back to the host's conversation surface. */
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
				try {
					handler(JSON.parse(textBlock.text) as TPayload);
				} catch {
					// Spec allows non-JSON text content; F4+ views will pick
					// the parsing strategy that matches their payload shape.
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

		sendMessage: async (text: string) => {
			await app.sendMessage({
				role: "user",
				content: [{ type: "text", text }],
			});
		},

		app,
	};
}
