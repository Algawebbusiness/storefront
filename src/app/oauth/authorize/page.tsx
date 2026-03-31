import { getClient, validateRedirectUri } from "@/lib/oauth/config";
import { validateScopes, parseScopes, SCOPE_DESCRIPTIONS } from "@/lib/oauth/scopes";
import { validateCodeChallenge } from "@/lib/oauth/pkce";
import { brandConfig } from "@/config/brand";

/**
 * OAuth2 Authorization endpoint.
 *
 * Validates the authorization request, then renders a login + consent form.
 * The form submits to /oauth/consent (POST) which handles authentication.
 *
 * Security:
 * - All params validated before rendering
 * - Invalid requests show error page (never redirect to unvalidated URIs)
 * - PKCE (S256) is required
 * - State parameter is required for CSRF protection
 */

interface AuthorizeParams {
	client_id?: string;
	redirect_uri?: string;
	response_type?: string;
	scope?: string;
	state?: string;
	code_challenge?: string;
	code_challenge_method?: string;
}

export default async function AuthorizePage({
	searchParams: searchParamsPromise,
}: {
	searchParams: Promise<AuthorizeParams>;
}) {
	const searchParams = await searchParamsPromise;

	const {
		client_id: clientId,
		redirect_uri: redirectUri,
		response_type: responseType,
		scope,
		state,
		code_challenge: codeChallenge,
		code_challenge_method: codeChallengeMethod,
	} = searchParams;

	// ── Validate all required parameters ──

	const errors: string[] = [];

	if (responseType !== "code") {
		errors.push("response_type must be 'code'");
	}

	if (!clientId) {
		errors.push("client_id is required");
	}

	if (!redirectUri) {
		errors.push("redirect_uri is required");
	}

	if (!state) {
		errors.push("state is required (CSRF protection)");
	}

	if (!codeChallenge || !codeChallengeMethod) {
		errors.push("PKCE is required (code_challenge and code_challenge_method)");
	}

	if (codeChallengeMethod && codeChallengeMethod !== "S256") {
		errors.push("code_challenge_method must be S256");
	}

	if (codeChallenge && !validateCodeChallenge(codeChallenge)) {
		errors.push("Invalid code_challenge format");
	}

	if (!scope || !validateScopes(scope)) {
		errors.push("scope is required and must contain valid scopes (profile, checkout, orders, addresses)");
	}

	// Validate client exists
	const client = clientId ? getClient(clientId) : null;
	if (clientId && !client) {
		errors.push("Unknown client_id");
	}

	// Validate redirect_uri matches client registration
	if (client && redirectUri && !validateRedirectUri(client, redirectUri)) {
		errors.push("redirect_uri is not registered for this client");
	}

	// ── Show error page if validation failed ──
	// NEVER redirect to an unvalidated redirect_uri with error info

	if (errors.length > 0) {
		return (
			<div className="mx-auto mt-16 w-full max-w-md">
				<div className="rounded-lg border border-destructive/50 bg-card p-8 shadow-sm">
					<h1 className="mb-4 text-xl font-semibold text-destructive">Authorization Error</h1>
					<ul className="space-y-2 text-sm text-muted-foreground">
						{errors.map((err) => (
							<li key={err}>• {err}</li>
						))}
					</ul>
					<p className="mt-6 text-xs text-muted-foreground">
						If you believe this is an error, contact the application developer.
					</p>
				</div>
			</div>
		);
	}

	// ── Render login + consent form ──

	const scopes = parseScopes(scope!);
	const clientName = client!.name;

	return (
		<div className="mx-auto mt-16 w-full max-w-md">
			<div className="rounded-lg border border-border bg-card p-8 shadow-sm">
				{/* Header */}
				<div className="mb-6 text-center">
					<p className="mb-2 text-sm text-muted-foreground">{brandConfig.siteName}</p>
					<h1 className="text-xl font-semibold">Authorize {clientName}</h1>
					<p className="mt-2 text-sm text-muted-foreground">
						<strong>{clientName}</strong> wants to access your account
					</p>
				</div>

				{/* Scope list */}
				<div className="mb-6 rounded-md border border-border bg-secondary/30 p-4">
					<p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
						This application will be able to:
					</p>
					<ul className="space-y-1.5 text-sm">
						{scopes.map((s) => (
							<li key={s} className="flex items-center gap-2">
								<svg className="h-4 w-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
								</svg>
								{SCOPE_DESCRIPTIONS[s].en}
							</li>
						))}
					</ul>
				</div>

				{/* Login form — submits to /oauth/consent */}
				<form action="/oauth/consent" method="POST" className="space-y-4">
					{/* Pass OAuth params as hidden fields */}
					<input type="hidden" name="client_id" value={clientId!} />
					<input type="hidden" name="redirect_uri" value={redirectUri!} />
					<input type="hidden" name="scope" value={scope!} />
					<input type="hidden" name="state" value={state!} />
					<input type="hidden" name="code_challenge" value={codeChallenge!} />
					<input type="hidden" name="code_challenge_method" value={codeChallengeMethod!} />

					<div className="space-y-1.5">
						<label htmlFor="oauth-email" className="text-sm font-medium">
							Email
						</label>
						<input
							id="oauth-email"
							name="email"
							type="email"
							autoComplete="email"
							required
							className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
							placeholder="you@example.com"
						/>
					</div>

					<div className="space-y-1.5">
						<label htmlFor="oauth-password" className="text-sm font-medium">
							Password
						</label>
						<input
							id="oauth-password"
							name="password"
							type="password"
							autoComplete="current-password"
							required
							className="flex h-12 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>

					<button
						type="submit"
						className="flex h-12 w-full items-center justify-center rounded-md bg-primary text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90"
					>
						Sign in & Authorize
					</button>

					<p className="text-center text-xs text-muted-foreground">
						By authorizing, you allow <strong>{clientName}</strong> to access the permissions listed above.
					</p>
				</form>
			</div>
		</div>
	);
}
