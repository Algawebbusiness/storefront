/**
 * Saleor authentication bridge for OAuth2.
 *
 * Authenticates customers against Saleor's GraphQL API and provides
 * user info for the OAuth2 flow. This is the only module that talks
 * to Saleor's auth system — all other OAuth modules work with our
 * own JWT tokens.
 */

const SALEOR_API_URL = process.env.NEXT_PUBLIC_SALEOR_API_URL;

const TOKEN_CREATE_MUTATION = `
	mutation TokenCreate($email: String!, $password: String!) {
		tokenCreate(email: $email, password: $password) {
			token
			refreshToken
			errors {
				field
				message
				code
			}
			user {
				id
				email
				firstName
				lastName
			}
		}
	}
`;

const ME_QUERY = `
	query Me {
		me {
			id
			email
			firstName
			lastName
			addresses {
				id
				firstName
				lastName
				streetAddress1
				streetAddress2
				city
				postalCode
				country {
					code
					country
				}
				phone
				isDefaultShippingAddress
				isDefaultBillingAddress
			}
		}
	}
`;

interface SaleorTokenResult {
	tokenCreate?: {
		token?: string;
		refreshToken?: string;
		errors?: Array<{ field?: string; message: string; code?: string }>;
		user?: {
			id: string;
			email: string;
			firstName: string;
			lastName: string;
		};
	};
}

interface SaleorMeResult {
	me?: {
		id: string;
		email: string;
		firstName: string;
		lastName: string;
		addresses?: Array<{
			id: string;
			firstName: string;
			lastName: string;
			streetAddress1: string;
			streetAddress2: string;
			city: string;
			postalCode: string;
			country: { code: string; country: string };
			phone: string;
			isDefaultShippingAddress: boolean;
			isDefaultBillingAddress: boolean;
		}>;
	};
}

async function saleorGraphQL<T>(query: string, variables?: Record<string, unknown>, token?: string): Promise<T | null> {
	if (!SALEOR_API_URL) return null;

	const headers: Record<string, string> = { "Content-Type": "application/json" };
	if (token) {
		headers["Authorization"] = `Bearer ${token}`;
	}

	try {
		const res = await fetch(SALEOR_API_URL, {
			method: "POST",
			headers,
			body: JSON.stringify({ query, variables }),
		});

		if (!res.ok) return null;

		const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
		if (json.errors?.length) return null;

		return json.data ?? null;
	} catch {
		return null;
	}
}

export interface SaleorLoginResult {
	accessToken: string;
	refreshToken: string;
	user: {
		id: string;
		email: string;
		firstName: string;
		lastName: string;
	};
}

/**
 * Authenticate a customer with Saleor.
 *
 * Returns Saleor tokens + user info on success.
 * Returns a generic error message on failure (doesn't leak user existence).
 */
export async function saleorLogin(
	email: string,
	password: string,
): Promise<{ ok: true; data: SaleorLoginResult } | { ok: false; error: string }> {
	const result = await saleorGraphQL<SaleorTokenResult>(TOKEN_CREATE_MUTATION, { email, password });

	if (!result?.tokenCreate) {
		return { ok: false, error: "Authentication service unavailable" };
	}

	const { token, refreshToken, errors, user } = result.tokenCreate;

	if (errors?.length || !token || !refreshToken || !user) {
		// Generic message — don't reveal whether the email exists
		return { ok: false, error: "Invalid email or password" };
	}

	return {
		ok: true,
		data: {
			accessToken: token,
			refreshToken,
			user,
		},
	};
}

/**
 * Fetch user info from Saleor using an access token.
 * Used by the /oauth/userinfo endpoint.
 */
export async function saleorUserInfo(saleorAccessToken: string) {
	const result = await saleorGraphQL<SaleorMeResult>(ME_QUERY, undefined, saleorAccessToken);
	return result?.me ?? null;
}
