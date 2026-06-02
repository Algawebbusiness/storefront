/**
 * OAuth2 consent handler.
 *
 * Receives the login form submission from /oauth/authorize.
 * Authenticates with Saleor, generates an authorization code,
 * and redirects to the client's redirect_uri.
 *
 * Security:
 * - Re-validates all OAuth params (never trust hidden form fields alone)
 * - Authenticates customer with Saleor (tokenCreate)
 * - Generic error messages (don't leak user existence)
 * - Redirect only to registered redirect_uris (exact match)
 * - Authorization code bound to client + redirect_uri + PKCE
 */

import { NextResponse } from "next/server";
import { getClient, validateRedirectUri } from "@/lib/oauth/config";
import { parseScopes, validateScopes } from "@/lib/oauth/scopes";
import { validateCodeChallenge } from "@/lib/oauth/pkce";
import { createAuthorizationCode } from "@/lib/oauth/codes";
import { saleorLogin } from "@/lib/oauth/saleor-auth";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
	const formData = await request.formData();

	const email = formData.get("email") as string | null;
	const password = formData.get("password") as string | null;
	const clientId = formData.get("client_id") as string | null;
	const redirectUri = formData.get("redirect_uri") as string | null;
	const scope = formData.get("scope") as string | null;
	const state = formData.get("state") as string | null;
	const codeChallenge = formData.get("code_challenge") as string | null;
	const codeChallengeMethod = formData.get("code_challenge_method") as string | null;

	// ── Re-validate all parameters ──

	if (!email || !password) {
		return redirectToAuthorize(clientId, "Email and password are required");
	}

	if (!clientId || !redirectUri || !scope || !state || !codeChallenge || !codeChallengeMethod) {
		return errorResponse("Missing required OAuth parameters");
	}

	if (codeChallengeMethod !== "S256") {
		return errorResponse("Invalid code_challenge_method");
	}

	if (!validateCodeChallenge(codeChallenge)) {
		return errorResponse("Invalid code_challenge");
	}

	if (!validateScopes(scope)) {
		return errorResponse("Invalid scope");
	}

	const client = getClient(clientId);
	if (!client) {
		return errorResponse("Unknown client");
	}

	// Narrow the requested scope to what THIS client is allowed (CWE-863). The
	// granted (intersected) scope is what gets bound to the code/token.
	const grantedScope = parseScopes(scope)
		.filter((s) => client.allowed_scopes.includes(s))
		.join(" ");
	if (!grantedScope) {
		return errorResponse("Requested scope is not allowed for this client");
	}

	if (!validateRedirectUri(client, redirectUri)) {
		return errorResponse("Invalid redirect_uri");
	}

	// ── Brute-force / credential-stuffing protection (CWE-307) ──
	const ip = clientIp(request);
	const [ipLimit, emailLimit] = await Promise.all([
		rateLimit(`login:ip:${ip}`, 20, 600), // 20 attempts / 10 min per IP
		rateLimit(`login:email:${email.toLowerCase()}`, 8, 900), // 8 / 15 min per account
	]);
	if (!ipLimit.allowed || !emailLimit.allowed) {
		const retry = Math.max(ipLimit.retryAfterSeconds, emailLimit.retryAfterSeconds);
		return new NextResponse("Too many login attempts. Please try again later.", {
			status: 429,
			headers: { "Retry-After": String(retry) },
		});
	}

	// ── Authenticate with Saleor ──

	const loginResult = await saleorLogin(email, password);

	if (!loginResult.ok) {
		// Redirect back to authorize page with error (not to redirect_uri)
		const authorizeUrl = new URL("/oauth/authorize", request.url);
		authorizeUrl.searchParams.set("client_id", clientId);
		authorizeUrl.searchParams.set("redirect_uri", redirectUri);
		authorizeUrl.searchParams.set("response_type", "code");
		authorizeUrl.searchParams.set("scope", scope);
		authorizeUrl.searchParams.set("state", state);
		authorizeUrl.searchParams.set("code_challenge", codeChallenge);
		authorizeUrl.searchParams.set("code_challenge_method", codeChallengeMethod);
		authorizeUrl.searchParams.set("error", "login_failed");

		console.log(`[OAuth] Login failed for client=${clientId} (generic message shown to user)`);

		return NextResponse.redirect(authorizeUrl);
	}

	// ── Generate authorization code ──

	const { data } = loginResult;

	const code = await createAuthorizationCode({
		clientId,
		redirectUri,
		scope: grantedScope,
		codeChallenge,
		codeChallengeMethod: "S256",
		saleorAccessToken: data.accessToken,
		saleorRefreshToken: data.refreshToken,
		userId: data.user.id,
		userEmail: data.user.email,
	});

	console.log(`[OAuth] Authorization granted: client=${clientId} user=${data.user.id} scope=${grantedScope}`);

	// ── Redirect to client with authorization code ──

	const callbackUrl = new URL(redirectUri);
	callbackUrl.searchParams.set("code", code);
	callbackUrl.searchParams.set("state", state);

	return NextResponse.redirect(callbackUrl);
}

function errorResponse(message: string): NextResponse {
	return NextResponse.json({ error: "invalid_request", error_description: message }, { status: 400 });
}

function redirectToAuthorize(_clientId: string | null, _message: string): NextResponse {
	return NextResponse.json(
		{ error: "invalid_request", error_description: "Missing credentials" },
		{ status: 400 },
	);
}
