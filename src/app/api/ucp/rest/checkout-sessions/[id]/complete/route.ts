/**
 * UCP REST — Complete checkout session
 *
 * POST /api/ucp/rest/checkout-sessions/[id]/complete
 *
 * Body: {
 *   payment: {
 *     type: "com.stripe.shared_payment_token",
 *     token: string
 *   }
 * }
 */

import { validateAgentApiKey } from "@/lib/protocols/shared/auth";
import {
	signedJsonResponse,
	signedProtocolDisabled,
	signedUnauthorized,
} from "@/lib/protocols/shared/response";
import { saleorQuery } from "@/mcp-server/saleor-client";
import { processStripePayment } from "@/lib/protocols/shared/payment";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import {
	CHECKOUT_BY_ID_QUERY,
	CHECKOUT_COMPLETE_MUTATION,
	type CheckoutByIdData,
	type CheckoutCompleteData,
} from "@/lib/protocols/shared/checkout-queries";
import { mapCheckoutToProtocol } from "@/lib/protocols/shared/checkout-mapper";

interface CompleteCheckoutBody {
	payment: {
		type: string;
		token: string;
	};
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	if (process.env.UCP_ENABLED !== "true") {
		return signedProtocolDisabled("UCP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return signedUnauthorized();
	}

	const { id } = await params;

	let body: CompleteCheckoutBody;
	try {
		body = (await request.json()) as CompleteCheckoutBody;
	} catch {
		return signedJsonResponse(
			{ error: { code: "bad_request", message: "Invalid JSON body" } },
			{ status: 400 },
		);
	}

	if (!body.payment?.token || !body.payment?.type) {
		return signedJsonResponse(
			{ error: { code: "bad_request", message: "payment.type and payment.token are required" } },
			{ status: 400 },
		);
	}

	if (body.payment.type !== "com.stripe.shared_payment_token") {
		return signedJsonResponse(
			{ error: { code: "bad_request", message: `Unsupported payment type: ${body.payment.type}` } },
			{ status: 400 },
		);
	}

	// Verify checkout exists
	const fetchResult = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });
	if (!fetchResult.ok) {
		return signedJsonResponse(
			{ error: { code: "server_error", message: fetchResult.error } },
			{ status: 500 },
		);
	}
	if (!fetchResult.data.checkout) {
		return signedJsonResponse(
			{ error: { code: "not_found", message: "Checkout session not found" } },
			{ status: 404 },
		);
	}

	// Process payment
	const paymentResult = await processStripePayment(id, body.payment.token);
	if (!paymentResult.ok) {
		return signedJsonResponse(
			{ error: { code: "payment_failed", message: paymentResult.error ?? "Payment processing failed" } },
			{ status: 400 },
		);
	}

	// Complete the checkout
	const completeResult = await saleorQuery<CheckoutCompleteData>(CHECKOUT_COMPLETE_MUTATION, {
		checkoutId: id,
	});

	if (!completeResult.ok) {
		return signedJsonResponse(
			{ error: { code: "server_error", message: completeResult.error } },
			{ status: 500 },
		);
	}

	const completeData = completeResult.data.checkoutComplete;
	if (completeData.errors.length > 0) {
		return signedJsonResponse(
			{ error: { code: "checkout_error", message: completeData.errors.map((e) => e.message).join("; ") } },
			{ status: 400 },
		);
	}

	const ucpMeta = await buildUcpMeta(auth.profileUrl);

	// Re-fetch checkout for final state (or return order info)
	const finalFetch = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });
	const checkoutData = finalFetch.ok ? finalFetch.data.checkout : null;

	return signedJsonResponse({
		ucp: ucpMeta,
		checkout_session: checkoutData
			? { ...mapCheckoutToProtocol(checkoutData), status: "completed" as const }
			: { id, status: "completed" as const },
		order: completeData.order ? { id: completeData.order.id, number: completeData.order.number } : null,
	});
}
