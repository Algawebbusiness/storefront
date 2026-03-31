/**
 * OAuth2 UserInfo endpoint (OpenID Connect compatible).
 *
 * Returns authenticated user's profile information.
 * Requires a valid access token with "profile" scope.
 *
 * GET /oauth/userinfo
 * Authorization: Bearer <access_token>
 */

import { verifyJwt } from "@/lib/oauth/tokens";
import { hasScope } from "@/lib/oauth/scopes";
import { saleorUserInfo } from "@/lib/oauth/saleor-auth";

export async function GET(request: Request) {
	const authHeader = request.headers.get("Authorization");

	if (!authHeader?.startsWith("Bearer ")) {
		return Response.json(
			{ error: "invalid_token", error_description: "Bearer token required" },
			{ status: 401, headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' } },
		);
	}

	const token = authHeader.slice(7);
	const payload = verifyJwt(token);

	if (!payload || payload.type !== "access") {
		return Response.json(
			{ error: "invalid_token", error_description: "Token is invalid or expired" },
			{ status: 401, headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' } },
		);
	}

	if (!hasScope(payload.scope, "profile")) {
		return Response.json(
			{ error: "insufficient_scope", error_description: "profile scope required" },
			{ status: 403, headers: { "WWW-Authenticate": 'Bearer error="insufficient_scope", scope="profile"' } },
		);
	}

	// Fetch user from Saleor
	const saleorToken = payload.saleor_token;
	if (!saleorToken) {
		return Response.json(
			{ error: "server_error", error_description: "Unable to fetch user profile" },
			{ status: 500 },
		);
	}

	const user = await saleorUserInfo(saleorToken);
	if (!user) {
		return Response.json(
			{ error: "server_error", error_description: "Unable to fetch user profile" },
			{ status: 500 },
		);
	}

	// Standard OIDC UserInfo response
	const response: Record<string, unknown> = {
		sub: user.id,
		email: user.email,
		name: [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined,
		given_name: user.firstName || undefined,
		family_name: user.lastName || undefined,
	};

	// Include addresses if scope allows
	if (hasScope(payload.scope, "addresses") && user.addresses) {
		response.addresses = user.addresses.map((a) => ({
			street: a.streetAddress1,
			city: a.city,
			postal_code: a.postalCode,
			country: a.country.code,
			is_default_shipping: a.isDefaultShippingAddress,
			is_default_billing: a.isDefaultBillingAddress,
		}));
	}

	return Response.json(response, {
		headers: { "Cache-Control": "no-store" },
	});
}
