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
 * Which Stripe payment-method wire format the agent is using. C6/C7 ship two:
 *   - `spt`         — Stripe Shared Payment Token (default, A6 baseline).
 *   - `link_wallet` — Stripe Link Agent Wallet (C7). The gateway data carries
 *                     `linkWalletToken` instead of `paymentToken`. Final
 *                     Stripe 2026 schema may rename this; the handler module
 *                     is the single source of truth and we'll realign once
 *                     the public spec lands.
 */
export type StripePaymentMethod = "spt" | "link_wallet";

/**
 * Process a Stripe payment token for a checkout. Dispatches Saleor's
 * `transactionInitialize` with the gateway-data shape appropriate for the
 * declared method (SPT or Link wallet), then walks transactionProcess if
 * the gateway needs another round-trip.
 */
export async function processStripePayment(
	checkoutId: string,
	token: string,
	method: StripePaymentMethod = "spt",
): Promise<PaymentResult> {
	const stripeGatewayId = process.env.STRIPE_GATEWAY_ID || "app.saleor.stripe";
	const gatewayData = method === "link_wallet"
		? { linkWalletToken: token, paymentMethodType: "link_wallet" }
		: { paymentToken: token };

	// Step 1: Initialize the transaction
	const initResult = await saleorQuery<TransactionInitializeData>(
		TRANSACTION_INITIALIZE_MUTATION,
		{
			checkoutId,
			paymentGateway: {
				id: stripeGatewayId,
				data: gatewayData,
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
