import { buildUcpProfile } from "@/lib/protocols/ucp/profile-builder";
import { protocolDisabledResponse } from "@/lib/protocols/shared/auth";

/**
 * UCP discovery endpoint.
 *
 * Returns the business profile JSON that UCP-compatible agents
 * (Google Gemini, etc.) read to discover what this store supports.
 *
 * GET /.well-known/ucp
 */
export async function GET() {
	if (process.env.UCP_ENABLED !== "true") {
		return protocolDisabledResponse("UCP");
	}

	const profile = buildUcpProfile();

	return Response.json(profile, {
		headers: {
			"Cache-Control": "public, max-age=3600",
			"Content-Type": "application/json",
		},
	});
}
