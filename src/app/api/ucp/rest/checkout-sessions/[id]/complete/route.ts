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
 *
 * The route wrapper supplies the cart total to `checkLimits` via
 * `computeAmountCents`, so per-session/day/month spending caps are enforced
 * *before* any Saleor mutation or Stripe charge runs.
 */

import { buildApprovalUrl, createPendingApproval, requiresApproval } from "@/lib/protocols/shared/approvals";
import { mapCheckoutToProtocol } from "@/lib/protocols/shared/checkout-mapper";
import {
	CHECKOUT_BY_ID_QUERY,
	CHECKOUT_COMPLETE_MUTATION,
	type CheckoutByIdData,
	type CheckoutCompleteData,
} from "@/lib/protocols/shared/checkout-queries";
import { acquireLock, releaseLock } from "@/lib/protocols/shared/idempotency";
import { recordSpend } from "@/lib/protocols/shared/limits";
import { ownsCheckout } from "@/lib/protocols/shared/ownership";
import { processStripePayment, type StripePaymentMethod } from "@/lib/protocols/shared/payment";
import { signedJsonResponse } from "@/lib/protocols/shared/response";
import { withUcpRoute } from "@/lib/protocols/shared/route-handler";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { saleorQuery } from "@/mcp-server/saleor-client";

interface CompleteCheckoutBody {
	payment: {
		type: string;
		token: string;
	};
}

interface CheckoutParams {
	id: string;
}

/**
 * Map the agent-facing `payment.type` string to the internal Stripe
 * payment method. Returns `null` for unsupported types so the route can
 * reject early with a 400.
 */
function paymentMethodFromType(type: string): StripePaymentMethod | null {
	switch (type) {
		case "com.stripe.shared_payment_token":
			return "spt";
		case "com.stripe.link_agent_wallet":
			return "link_wallet";
		default:
			return null;
	}
}

async function fetchCheckoutTotalCents(id: string): Promise<number | null> {
	const result = await saleorQuery<CheckoutByIdData>(CHECKOUT_BY_ID_QUERY, { id });
	if (!result.ok || !result.data.checkout) return null;
	return Math.round(result.data.checkout.totalPrice.gross.amount * 100);
}

export const POST = withUcpRoute<CheckoutParams>(
	{
		action: "checkout.complete",
		scope: "checkout.complete",
		resourceId: (p) => p.id,
		computeAmountCents: async (_auth, { id }) => fetchCheckoutTotalCents(id),
	},
	async (_request, auth, { id }) => {
		let body: CompleteCheckoutBody;
		try {
			body = JSON.parse(auth.bodyText) as CompleteCheckoutBody;
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

		const paymentMethod = paymentMethodFromType(body.payment.type);
		if (!paymentMethod) {
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
		if (!fetchResult.data.checkout || !ownsCheckout(fetchResult.data.checkout, auth)) {
			// SECURITY (IDOR, CWE-639): only the owning agent/customer may complete
			// (charge) this checkout. 404 to a non-owner so existence isn't leaked.
			return signedJsonResponse(
				{ error: { code: "not_found", message: "Checkout session not found" } },
				{ status: 404 },
			);
		}

		// Phase B6: high-value checkouts require merchant approval before paying.
		// Reads APPROVAL_THRESHOLD_CENTS env (per-tenant override comes in Phase E).
		const totalCents = Math.round(fetchResult.data.checkout.totalPrice.gross.amount * 100);
		if (requiresApproval(totalCents)) {
			const approval = await createPendingApproval({
				agent_id: auth.agent.id,
				action: "checkout.complete",
				resource_id: id,
				amount_cents: totalCents,
				reason: `Cart total ${totalCents}¢ exceeds APPROVAL_THRESHOLD_CENTS`,
			});
			return signedJsonResponse(
				{
					status: "pending_approval",
					approval_id: approval.id,
					approval_url: buildApprovalUrl(approval.id),
					approval_expires_at: approval.expires_at,
				},
				{ status: 202 },
			);
		}

		// SECURITY (CWE-367): take a per-checkout lock so concurrent POSTs / retries
		// can't double-charge. Acquired AFTER the approval gate (a 202 must not burn
		// the lock). Released on failure (retryable); kept on success (rejects dupes).
		if (!(await acquireLock(`checkout-complete:${id}`))) {
			return signedJsonResponse(
				{ error: { code: "conflict", message: "A completion for this checkout is already in progress" } },
				{ status: 409 },
			);
		}

		let completed = false;
		try {
			// Process payment
			const paymentResult = await processStripePayment(id, body.payment.token, paymentMethod);
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
					{
						error: { code: "checkout_error", message: completeData.errors.map((e) => e.message).join("; ") },
					},
					{ status: 400 },
				);
			}

			// Past the charge + completion → keep the lock so a duplicate submit 409s.
			completed = true;

			// Record committed spend so per-day/month caps reflect real spend.
			await recordSpend(auth.agent.id, totalCents);

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
		} finally {
			if (!completed) await releaseLock(`checkout-complete:${id}`);
		}
	},
);
