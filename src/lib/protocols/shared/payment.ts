/**
 * Stripe shared payment token handling for ACP/UCP checkout completion.
 *
 * Uses Saleor's transactionInitialize + transactionProcess mutations
 * to process Stripe payment tokens provided by AI agents.
 */

import { saleorQuery } from "@/mcp-server/saleor-client";
import {
	TRANSACTION_INITIALIZE_MUTATION,
	TRANSACTION_PROCESS_MUTATION,
	type TransactionInitializeData,
	type TransactionProcessData,
} from "./checkout-queries";

/** Result of a payment processing attempt */
export interface PaymentResult {
	ok: boolean;
	transactionId?: string;
	status?: string;
	error?: string;
}

/**
 * Process a Stripe shared payment token for a checkout.
 *
 * This calls transactionInitialize to set up the payment, then
 * transactionProcess to finalize it with the Stripe token data.
 */
export async function processStripePayment(
	checkoutId: string,
	token: string,
): Promise<PaymentResult> {
	const stripeGatewayId = process.env.STRIPE_GATEWAY_ID || "app.saleor.stripe";

	// Step 1: Initialize the transaction
	const initResult = await saleorQuery<TransactionInitializeData>(
		TRANSACTION_INITIALIZE_MUTATION,
		{
			checkoutId,
			paymentGateway: {
				id: stripeGatewayId,
				data: { paymentToken: token },
			},
		},
	);

	if (!initResult.ok) {
		return { ok: false, error: initResult.error };
	}

	const initData = initResult.data.transactionInitialize;

	if (initData.errors.length > 0) {
		return {
			ok: false,
			error: initData.errors.map((e) => e.message).join("; "),
		};
	}

	if (!initData.transaction) {
		return { ok: false, error: "No transaction returned from initialization" };
	}

	const transactionId = initData.transaction.id;

	// If the transaction is already in a final state, return
	if (initData.transaction.status === "AUTHORIZED" || initData.transaction.status === "CHARGED") {
		return {
			ok: true,
			transactionId,
			status: initData.transaction.status,
		};
	}

	// Step 2: Process the transaction if further processing is needed
	const processResult = await saleorQuery<TransactionProcessData>(
		TRANSACTION_PROCESS_MUTATION,
		{
			transactionId,
			data: initData.data,
		},
	);

	if (!processResult.ok) {
		return { ok: false, error: processResult.error };
	}

	const processData = processResult.data.transactionProcess;

	if (processData.errors.length > 0) {
		return {
			ok: false,
			error: processData.errors.map((e) => e.message).join("; "),
		};
	}

	return {
		ok: true,
		transactionId: processData.transaction?.id ?? transactionId,
		status: processData.transaction?.status ?? "unknown",
	};
}
