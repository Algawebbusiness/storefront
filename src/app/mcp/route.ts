import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createMcpServer } from "@/mcp-server";

/**
 * MCP (Model Context Protocol) endpoint for AI agents.
 *
 * Uses the Streamable HTTP transport (Web Standard APIs).
 * Stateless mode — each request creates a fresh server+transport pair.
 *
 * POST /mcp — JSON-RPC messages (initialize, tool calls, etc.)
 * GET  /mcp — SSE stream for server-initiated notifications
 * DELETE /mcp — Session termination (no-op in stateless mode)
 *
 * The transport itself is unauthenticated. The browse/search tools are public
 * read-only; money-moving (checkout) and PII (order/cart-full) tools enforce
 * api_key auth via the shared, fail-closed `isMcpApiKeyAuthorized`, which in
 * production refuses the "trust transport" shortcut unless an operator puts
 * real auth in front of `/mcp` and sets `MCP_TRUST_TRANSPORT=true`.
 * TODO (Block 3b): bind tool access to a verified agent identity / split the
 * public read-only server from the authenticated checkout server.
 */

async function handleMcpRequest(request: Request): Promise<Response> {
	const server = createMcpServer();

	const transport = new WebStandardStreamableHTTPServerTransport({
		sessionIdGenerator: undefined, // stateless mode
		enableJsonResponse: true, // prefer JSON over SSE for simple request/response
	});

	await server.connect(transport);

	try {
		return await transport.handleRequest(request);
	} catch (err) {
		console.error("[MCP] Request handling error:", err);
		return Response.json(
			{ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null },
			{ status: 500 },
		);
	}
}

export async function GET(request: Request) {
	return handleMcpRequest(request);
}

export async function POST(request: Request) {
	return handleMcpRequest(request);
}

export async function DELETE(request: Request) {
	return handleMcpRequest(request);
}
