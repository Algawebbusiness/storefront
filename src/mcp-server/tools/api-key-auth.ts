/**
 * Shared api_key authorization for MCP tools (replaces the per-file copies of
 * `validateApiKey` / `validateOptionalApiKey`).
 *
 * SECURITY (CWE-306/862): the `/mcp` HTTP transport is currently public, so the
 * historical "api_key === undefined ⇒ trust the transport" shortcut means
 * money-moving (`complete_checkout`) and PII (`get_order_full`) tools were
 * callable with no authentication. We fail closed in production:
 *
 *   - `undefined` api_key (iframe-relay "trust transport") is honored ONLY in
 *     dev/test, or when the operator asserts the transport is authenticated via
 *     `MCP_TRUST_TRANSPORT=true` (e.g. an auth proxy in front of `/mcp`).
 *   - When `AGENT_API_KEYS` is configured, a supplied key must match.
 *   - When it is NOT configured, the same dev/opt-in rule as `undefined`.
 */
function transportTrusted(): boolean {
	return process.env.NODE_ENV !== "production" || process.env.MCP_TRUST_TRANSPORT === "true";
}

/** True when the supplied api_key is acceptable for an MCP tool call. */
export function isMcpApiKeyAuthorized(apiKey: string | undefined): boolean {
	if (apiKey === undefined) return transportTrusted();

	const keys = process.env.AGENT_API_KEYS || "";
	const validKeys = new Set(
		keys
			.split(",")
			.map((k) => k.trim())
			.filter(Boolean),
	);
	if (validKeys.size === 0) return transportTrusted();
	return validKeys.has(apiKey);
}
