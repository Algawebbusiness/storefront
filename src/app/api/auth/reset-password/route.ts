import { NextRequest, NextResponse } from "next/server";
import { executeRawGraphQL, getUserMessage } from "@/lib/graphql";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const REQUEST_PASSWORD_RESET_MUTATION = `
  mutation RequestPasswordReset($email: String!, $channel: String!, $redirectUrl: String!) {
    requestPasswordReset(email: $email, channel: $channel, redirectUrl: $redirectUrl) {
      errors {
        field
        message
        code
      }
    }
  }
`;

interface ResetPasswordRequest {
	email: string;
	channel: string;
	redirectUrl: string;
}

interface RequestPasswordResetResult {
	requestPasswordReset?: {
		errors?: Array<{ field?: string | null; message: string; code?: string | null }>;
	};
}

export async function POST(request: NextRequest) {
	const body = (await request.json()) as ResetPasswordRequest;
	const { email, channel, redirectUrl } = body;

	if (!email || !channel || !redirectUrl) {
		return NextResponse.json(
			{ errors: [{ message: "Email, channel, and redirectUrl are required", code: "REQUIRED" }] },
			{ status: 400 },
		);
	}

	// Throttle reset-email sending (anti email-bomb / abuse, CWE-307). Keyed on
	// email + IP regardless of whether the account exists → no enumeration signal.
	const ip = clientIp(request);
	const [emailLimit, ipLimit] = await Promise.all([
		rateLimit(`pwreset:email:${email.toLowerCase()}`, 3, 3600), // 3 / hour per email
		rateLimit(`pwreset:ip:${ip}`, 15, 3600), // 15 / hour per IP
	]);
	if (!emailLimit.allowed || !ipLimit.allowed) {
		const retry = Math.max(emailLimit.retryAfterSeconds, ipLimit.retryAfterSeconds);
		return NextResponse.json(
			{ errors: [{ message: "Too many reset requests. Please try again later.", code: "RATE_LIMITED" }] },
			{ status: 429, headers: { "Retry-After": String(retry) } },
		);
	}

	const result = await executeRawGraphQL<RequestPasswordResetResult>({
		query: REQUEST_PASSWORD_RESET_MUTATION,
		variables: { email, channel, redirectUrl },
	});

	// Network or GraphQL error
	if (!result.ok) {
		console.error("Password reset error:", result.error.type);
		return NextResponse.json(
			{ errors: [{ message: getUserMessage(result.error), code: result.error.type.toUpperCase() }] },
			{ status: result.error.type === "network" ? 503 : 400 },
		);
	}

	const requestPasswordReset = result.data.requestPasswordReset;

	// Saleor validation errors - log but don't expose to prevent email enumeration
	if (requestPasswordReset?.errors?.length) {
		console.error("Password reset validation errors");
		// Still return success to prevent email enumeration
	}

	// Always return success to prevent email enumeration
	return NextResponse.json({ success: true });
}
