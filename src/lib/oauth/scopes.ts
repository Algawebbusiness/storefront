/**
 * OAuth2 scope definitions.
 *
 * Scopes define what an agent can access on behalf of the customer.
 * Each scope maps to a set of Saleor permissions/capabilities.
 */

export const VALID_SCOPES = ["profile", "checkout", "orders", "addresses"] as const;
export type OAuthScope = (typeof VALID_SCOPES)[number];

/** Human-readable scope descriptions (for consent screen) */
export const SCOPE_DESCRIPTIONS: Record<OAuthScope, { en: string; cs: string }> = {
	profile: {
		en: "View your name and email",
		cs: "Zobrazit vaše jméno a e-mail",
	},
	checkout: {
		en: "Create orders and manage your cart",
		cs: "Vytvářet objednávky a spravovat košík",
	},
	orders: {
		en: "View your order history",
		cs: "Zobrazit historii objednávek",
	},
	addresses: {
		en: "Access your saved addresses",
		cs: "Přistoupit k uloženým adresám",
	},
};

/** Parse and validate a space-separated scope string */
export function parseScopes(scopeString: string): OAuthScope[] {
	const requested = scopeString.split(/\s+/).filter(Boolean);
	const valid: OAuthScope[] = [];

	for (const scope of requested) {
		if (VALID_SCOPES.includes(scope as OAuthScope)) {
			valid.push(scope as OAuthScope);
		}
	}

	return valid;
}

/** Check if a scope string contains only valid scopes */
export function validateScopes(scopeString: string): boolean {
	const parts = scopeString.split(/\s+/).filter(Boolean);
	return parts.length > 0 && parts.every((s) => VALID_SCOPES.includes(s as OAuthScope));
}

/** Check if granted scopes include a required scope */
export function hasScope(grantedScopes: string, required: OAuthScope): boolean {
	return grantedScopes.split(/\s+/).includes(required);
}
