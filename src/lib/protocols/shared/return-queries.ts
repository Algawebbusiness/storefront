/**
 * Saleor GraphQL mutations for the C2 returns flow.
 *
 * Two Saleor verbs are relevant:
 *
 *   - `orderRefund(id, amount)` — full or arbitrary-amount refund against the
 *     order's payment. Used for full-order returns and for store-credit refunds
 *     where we choose the amount ourselves.
 *
 *   - `orderFulfillmentReturnProducts` — partial return against fulfilled
 *     lines. Heavier shape: requires fulfillment-line IDs (Saleor binds the
 *     return to physical line items in a fulfillment, not order lines). Not
 *     wired in C2 — partial returns persist as `pending` and the merchant
 *     drives them through Saleor admin until a later phase tackles the
 *     fulfillment-line mapping.
 *
 * Both mutations need an admin token (SALEOR_APP_TOKEN with MANAGE_ORDERS).
 * The wrapper in `triggerSaleorRefund` performs the admin fetch and shapes
 * the response so the route handler stays simple.
 */

/**
 * Saleor `orderRefund` mutation. `amount` is the gross amount in major units
 * (Saleor decimals) — convert from cents at the call site.
 */
export const ORDER_REFUND_MUTATION = `
	mutation ProtocolOrderRefund($id: ID!, $amount: PositiveDecimal!) {
		orderRefund(id: $id, amount: $amount) {
			order {
				id
				status
			}
			errors {
				field
				message
				code
			}
		}
	}
`;

export interface SaleorOrderRefundData {
	orderRefund: {
		order: { id: string; status: string } | null;
		errors: Array<{ field: string | null; message: string; code: string }>;
	};
}

export type SaleorRefundOutcome =
	| { ok: true; orderStatus: string }
	| { ok: false; reason: string };

/**
 * Trigger a Saleor `orderRefund` for the given order. Returns the post-refund
 * order status on success.
 *
 * Failure modes:
 *   - `unconfigured` — SALEOR_API_URL or SALEOR_APP_TOKEN missing. Treated as
 *     a soft failure: the local return record stays `pending` and the merchant
 *     can complete it from Saleor admin.
 *   - `network` / `graphql` — fetch failed or Saleor returned errors.
 */
export async function triggerSaleorRefund(params: {
	orderId: string;
	amountMajorUnits: number;
}): Promise<SaleorRefundOutcome> {
	const apiUrl = process.env.NEXT_PUBLIC_SALEOR_API_URL;
	const appToken = process.env.SALEOR_APP_TOKEN;
	if (!apiUrl || !appToken) {
		return { ok: false, reason: "unconfigured" };
	}

	try {
		const res = await fetch(apiUrl, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${appToken}`,
			},
			body: JSON.stringify({
				query: ORDER_REFUND_MUTATION,
				variables: { id: params.orderId, amount: params.amountMajorUnits },
			}),
		});

		if (!res.ok) {
			return { ok: false, reason: `Saleor HTTP ${res.status}` };
		}

		const json = (await res.json()) as {
			data?: SaleorOrderRefundData;
			errors?: Array<{ message: string }>;
		};

		if (json.errors && json.errors.length > 0) {
			return { ok: false, reason: json.errors.map((e) => e.message).join("; ") };
		}

		const data = json.data?.orderRefund;
		if (!data) {
			return { ok: false, reason: "Empty orderRefund response" };
		}
		if (data.errors.length > 0) {
			return { ok: false, reason: data.errors.map((e) => e.message).join("; ") };
		}
		if (!data.order) {
			return { ok: false, reason: "Saleor refund returned no order" };
		}

		return { ok: true, orderStatus: data.order.status };
	} catch (err) {
		return {
			ok: false,
			reason: `Refund request failed: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}
