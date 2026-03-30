/**
 * ACP — Complete checkout with Stripe payment token
 *
 * POST /api/acp/checkout/[id]/complete
 *
 * Body: {
 *   payment_token: string   // Stripe shared payment token
 * }
 */

import { NextResponse } from "next/server";
import { validateAgentApiKey, unauthorizedResponse, protocolDisabledResponse } from "@/lib/protocols/shared/auth";
import { saleorQuery } from "@/mcp-server/saleor-client";
import { processStripePayment } from "@/lib/protocols/shared/payment";
import { mapCheckoutToProtocol } from "@/lib/protocols/shared/checkout-mapper";
import {
	CHECKOUT_BY_ID_QUERY,
	CHECKOUT_COMPLETE_MUTATION,
	type CheckoutByIdData,
	type CheckoutCompleteData,
} from "@/lib/protocols/shared/checkout-queries";

interface CompleteAcpCheckoutBody {
	payment_token: string;
}

export async function POST(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	if (process.env.ACP_ENABLED !== "true") {
		return protocolDisabledResponse("ACP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return unauthorizedResponse();
	}

	const { id } = await params;

	let body: CompleteAcpCheckoutBody;
	try {
		body = (await request.json()) as CompleteAcpCheckoutBody;
	} catch {
		return NextResponse.json(
			{ error: { code: "bad_request", message: "Invalid JSON body" } },
			{ status: 400 },
		);
	}

	if (!body.payment_token) {
		return NextResponse.json(
			{ error: { code: "bad_request", message: "payment_token is required" } },
			{ status: 400 },
		);
	}

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

	// Process Stripe payment
	const paymentResult = await processStripePayment(id, body.payment_token);
	if (!paymentResult.ok) {
		return NextResponse.json(
			{ error: { code: "payment_failed", message: paymentResult.error ?? "Payment processing failed" } },
			{ status: 400 },
		);
	}

	// Complete the checkout
	const completeResult = await saleorQuery<CheckoutCompleteData>(CHECKOUT_COMPLETE_MUTATION, {
		checkoutId: id,
	});

	if (!completeResult.ok) {
		return NextResponse.json(
			{ error: { code: "server_error", message: completeResult.error } },
			{ status: 500 },
		);
	}

	const completeData = completeResult.data.checkoutComplete;
	if (completeData.errors.length > 0) {
		return NextResponse.json(
			{ error: { code: "checkout_error", message: completeData.errors.map((e) => e.message).join("; ") } },
			{ status: 400 },
		);
	}

	// Re-fetch for final state
	const finalFetch = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });
	const checkoutData = finalFetch.ok ? finalFetch.data.checkout : null;

	return NextResponse.json({
		checkout_session: checkoutData
			? { ...mapCheckoutToProtocol(checkoutData), status: "completed" as const }
			: { id, status: "completed" as const },
		order: completeData.order
			? { id: completeData.order.id, number: completeData.order.number }
			: null,
	});
}
