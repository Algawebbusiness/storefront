/**
 * UCP REST — Cancel checkout session
 *
 * POST /api/ucp/rest/checkout-sessions/[id]/cancel
 *
 * Marks a checkout as cancelled. Saleor does not have a native cancel mutation,
 * so we return the cancelled status without modifying server state.
 * The checkout will expire naturally via Saleor's TTL.
 */

import { NextResponse } from "next/server";
import { validateAgentApiKey, unauthorizedResponse, protocolDisabledResponse } from "@/lib/protocols/shared/auth";
import { saleorQuery } from "@/mcp-server/saleor-client";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { mapCheckoutToProtocol } from "@/lib/protocols/shared/checkout-mapper";
import {
	CHECKOUT_BY_ID_QUERY,
	type CheckoutByIdData,
} from "@/lib/protocols/shared/checkout-queries";

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	if (process.env.UCP_ENABLED !== "true") {
		return protocolDisabledResponse("UCP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return unauthorizedResponse();
	}

	const { id } = await params;

	// Verify checkout exists
	const fetchResult = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });
	if (!fetchResult.ok) {
		return NextResponse.json(
			{ error: { code: "server_error", message: fetchResult.error } },
			{ status: 500 },
		);
	}
	if (!fetchResult.data.checkout) {
		return NextResponse.json(
			{ error: { code: "not_found", message: "Checkout session not found" } },
			{ status: 404 },
		);
	}

	const ucpMeta = await buildUcpMeta(auth.profileUrl);

	return NextResponse.json({
		ucp: ucpMeta,
		checkout_session: {
			...mapCheckoutToProtocol(fetchResult.data.checkout),
			status: "cancelled" as const,
		},
	});
}
