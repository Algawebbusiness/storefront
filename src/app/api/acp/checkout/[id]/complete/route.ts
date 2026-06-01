/**
 * ACP — Complete checkout with Stripe payment token
 *
 * POST /api/acp/checkout/[id]/complete
 *
 * Body: {
 *   payment_token: string   // Stripe shared payment token
 * }
 *
 * Runs the full guard chain via `withAcpRoute` (scope `checkout.complete`,
 * spending cap, rate limit, activity log) plus the B6 high-value approval gate
 * — previously this route bypassed all of them (audit Block 4).
 */

import { NextResponse } from "next/server";
import { withAcpRoute } from "@/lib/protocols/acp/route-handler";
import { buildApprovalUrl, createPendingApproval, requiresApproval } from "@/lib/protocols/shared/approvals";
import { saleorQuery } from "@/mcp-server/saleor-client";
import { processStripePayment } from "@/lib/protocols/shared/payment";
import { mapCheckoutToProtocol } from "@/lib/protocols/shared/checkout-mapper";
import { ownsCheckout } from "@/lib/protocols/shared/ownership";
import {
	CHECKOUT_BY_ID_QUERY,
	CHECKOUT_COMPLETE_MUTATION,
	type CheckoutByIdData,
	type CheckoutCompleteData,
} from "@/lib/protocols/shared/checkout-queries";

interface CompleteAcpCheckoutBody {
	payment_token: string;
}

interface CheckoutParams {
	id: string;
}

async function fetchCheckoutTotalCents(id: string): Promise<number | null> {
	const result = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });
	if (!result.ok || !result.data.checkout) return null;
	return Math.round(result.data.checkout.totalPrice.gross.amount * 100);
}

export const POST = withAcpRoute<CheckoutParams>(
	{
		action: "checkout.complete",
		scope: "checkout.complete",
		resourceId: (p) => p.id,
		computeAmountCents: async (_auth, { id }) => fetchCheckoutTotalCents(id),
	},
	async (_request, auth, { id }) => {
		let body: CompleteAcpCheckoutBody;
		try {
			body = JSON.parse(auth.bodyText) as CompleteAcpCheckoutBody;
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
		if (!fetchResult.data.checkout || !ownsCheckout(fetchResult.data.checkout, auth)) {
			// SECURITY (IDOR, CWE-639): only the owning agent/customer may complete
			// (charge) this checkout. 404 to a non-owner so existence isn't leaked.
			return NextResponse.json(
				{ error: { code: "not_found", message: "Checkout session not found" } },
				{ status: 404 },
			);
		}

		// B6: high-value checkouts require merchant approval before paying.
		const totalCents = Math.round(fetchResult.data.checkout.totalPrice.gross.amount * 100);
		if (requiresApproval(totalCents)) {
			const approval = await createPendingApproval({
				agent_id: auth.agent.id,
				action: "checkout.complete",
				resource_id: id,
				amount_cents: totalCents,
				reason: `Cart total ${totalCents}¢ exceeds APPROVAL_THRESHOLD_CENTS`,
			});
			return NextResponse.json(
				{
					status: "pending_approval",
					approval_id: approval.id,
					approval_url: buildApprovalUrl(approval.id),
					approval_expires_at: approval.expires_at,
				},
				{ status: 202 },
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
			order: completeData.order ? { id: completeData.order.id, number: completeData.order.number } : null,
		});
	},
);
