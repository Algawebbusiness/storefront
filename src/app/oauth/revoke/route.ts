/**
 * OAuth2 token revocation endpoint.
 *
 * Allows clients to revoke refresh tokens.
 * Follows RFC 7009 (OAuth 2.0 Token Revocation).
 *
 * POST /oauth/revoke
 */

import { getClient, verifyClientSecret } from "@/lib/oauth/config";
import { verifyJwt, revokeRefreshToken } from "@/lib/oauth/tokens";

export async function POST(request: Request) {
	const contentType = request.headers.get("content-type") || "";
	let body: Record<string, string>;

	try {
		if (contentType.includes("application/x-www-form-urlencoded")) {
			const formData = await request.formData();
			body = Object.fromEntries(formData.entries()) as Record<string, string>;
		} else {
			body = (await request.json()) as Record<string, string>;
		}
	} catch {
		return Response.json({ error: "invalid_request" }, { status: 400 });
	}

	const { token, client_id, client_secret } = body;

	if (!token || !client_id || !client_secret) {
		return Response.json(
			{ error: "invalid_request", error_description: "token, client_id, and client_secret are required" },
			{ status: 400 },
		);
	}

	// Validate client
	const client = getClient(client_id);
	if (!client || !verifyClientSecret(client, client_secret)) {
		return Response.json({ error: "invalid_client" }, { status: 401 });
	}

	// Verify and revoke
	const payload = verifyJwt(token);
	if (payload && payload.type === "refresh" && payload.client_id === client_id) {
		revokeRefreshToken(payload.jti);
		console.log(`[OAuth] Token revoked: client=${client_id} user=${payload.sub}`);
	}

	// RFC 7009: always return 200, even if token was invalid
	return new Response(null, { status: 200 });
}
