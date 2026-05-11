/**
 * Saleor webhook handler for order events.
 *
 * POST /api/webhooks/saleor
 *
 * Handles ORDER_CREATED, ORDER_FULFILLED, ORDER_CANCELLED, ORDER_PAID events.
 * Verifies HMAC signature from Saleor-Signature header when SALEOR_WEBHOOK_SECRET is set.
 */

import { createHmac, timingSafeEqual } from "crypto";

import {
	contextToMetadataInput,
	extractContextFromMetadata,
	type SaleorMetadataItem,
} from "@/lib/protocols/shared/context-mapper";
import {
	findPendingReturnForOrder,
	updateReturnStatus,
} from "@/lib/protocols/shared/return-mapper";

const WEBHOOK_SECRET = process.env.SALEOR_WEBHOOK_SECRET;
const SALEOR_API_URL = process.env.NEXT_PUBLIC_SALEOR_API_URL;
const SALEOR_APP_TOKEN = process.env.SALEOR_APP_TOKEN;

/**
 * Propagate UCP `context` (intent, buyer_preferences, agent_session_id) from
 * the source checkout's metadata to the order's metadata when an order is
 * created (Phase A7).
 *
 * Best effort: needs SALEOR_APP_TOKEN with MANAGE_ORDERS permission.
 * Without the token we log and skip — the order is otherwise unaffected.
 */
async function propagateIntentToOrder(orderId: string): Promise<void> {
	if (!SALEOR_API_URL || !SALEOR_APP_TOKEN) {
		console.log(
			"[Webhook/Saleor] Intent propagation skipped: SALEOR_API_URL or SALEOR_APP_TOKEN not set",
		);
		return;
	}

	const fetchOrderQuery = `
		query OrderForIntentPropagation($id: ID!) {
			order(id: $id) { id checkoutId metadata { key value } }
		}
	`;
	const fetchCheckoutQuery = `
		query CheckoutMetadataForIntent($id: ID!) {
			checkout(id: $id) { metadata { key value } }
		}
	`;
	const writeMetadataMutation = `
		mutation OrderUpdateMetadata($id: ID!, $input: [MetadataInput!]!) {
			updateMetadata(id: $id, input: $input) { errors { field message code } }
		}
	`;

	type GraphQLResponse<T> = { data?: T; errors?: Array<{ message: string }> };
	async function adminFetch<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
		try {
			const res = await fetch(SALEOR_API_URL!, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${SALEOR_APP_TOKEN}`,
				},
				body: JSON.stringify({ query, variables }),
			});
			if (!res.ok) return null;
			const json = (await res.json()) as GraphQLResponse<T>;
			if (json.errors && json.errors.length > 0) return null;
			return json.data ?? null;
		} catch {
			return null;
		}
	}

	type OrderData = {
		order: { id: string; checkoutId: string | null; metadata: SaleorMetadataItem[] } | null;
	};
	const orderData = await adminFetch<OrderData>(fetchOrderQuery, { id: orderId });
	if (!orderData?.order || !orderData.order.checkoutId) {
		console.log(`[Webhook/Saleor] Intent propagation: order ${orderId} has no source checkoutId`);
		return;
	}

	// Idempotent: skip if order already has context (webhook retries).
	if (extractContextFromMetadata(orderData.order.metadata)) return;

	type CheckoutData = { checkout: { metadata: SaleorMetadataItem[] } | null };
	const checkoutData = await adminFetch<CheckoutData>(fetchCheckoutQuery, {
		id: orderData.order.checkoutId,
	});
	const context = extractContextFromMetadata(checkoutData?.checkout?.metadata);
	if (!context) return;

	const input = contextToMetadataInput(context);
	if (!input) return;

	type WriteData = { updateMetadata: { errors: Array<{ message: string }> } };
	const written = await adminFetch<WriteData>(writeMetadataMutation, { id: orderId, input });
	if (!written || written.updateMetadata.errors.length > 0) {
		console.warn(
			`[Webhook/Saleor] Intent propagation failed for order ${orderId}: ${written ? written.updateMetadata.errors.map((e) => e.message).join("; ") : "fetch error"}`,
		);
		return;
	}
	console.log(`[Webhook/Saleor] Intent propagated from checkout to order ${orderId}`);
}

/** Verify Saleor webhook HMAC signature */
function verifyWebhookSignature(body: string, signature: string, secret: string): boolean {
	const hmac = createHmac("sha256", secret);
	hmac.update(body);
	const expected = hmac.digest("hex");

	try {
		return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
	} catch {
		return false;
	}
}

/** Known order event types */
type OrderEvent =
	| "ORDER_CREATED"
	| "ORDER_FULFILLED"
	| "ORDER_CANCELLED"
	| "ORDER_PAID"
	| "ORDER_REFUNDED"
	| "ORDER_RETURN_REQUESTED";

interface WebhookPayload {
	event?: string;
	payload?: {
		order?: {
			id?: string;
			number?: string;
			status?: string;
			isPaid?: boolean;
		};
	};
	// Saleor may also send a flat structure depending on version
	order?: {
		id?: string;
		number?: string;
		status?: string;
		isPaid?: boolean;
	};
}

function isKnownOrderEvent(event: string): event is OrderEvent {
	return [
		"ORDER_CREATED",
		"ORDER_FULFILLED",
		"ORDER_CANCELLED",
		"ORDER_PAID",
		"ORDER_REFUNDED",
		"ORDER_RETURN_REQUESTED",
	].includes(event);
}

export async function POST(request: Request): Promise<Response> {
	const rawBody = await request.text();

	// Verify signature if secret is configured
	if (WEBHOOK_SECRET) {
		const signature = request.headers.get("Saleor-Signature");
		if (!signature || !verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET)) {
			console.warn("[Webhook/Saleor] Invalid or missing signature");
			return Response.json(
				{ error: "Unauthorized" },
				{ status: 401 },
			);
		}
	}

	let payload: WebhookPayload;
	try {
		payload = JSON.parse(rawBody) as WebhookPayload;
	} catch {
		return Response.json(
			{ error: "Invalid JSON" },
			{ status: 400 },
		);
	}

	// Extract event type from payload or header
	const eventType = (
		payload.event ??
		request.headers.get("Saleor-Event") ??
		""
	).toUpperCase();

	if (!eventType) {
		return Response.json(
			{ error: "Missing event type" },
			{ status: 400 },
		);
	}

	// Extract order data (Saleor may nest it under payload.order or order directly)
	const orderData = payload.payload?.order ?? payload.order;
	const orderId = orderData?.id ?? "unknown";
	const orderNumber = orderData?.number ?? "unknown";

	// Sanitize for logging
	const safeOrderId = orderId.replace(/[\r\n]/g, "");
	const safeOrderNumber = orderNumber.replace(/[\r\n]/g, "");
	const safeEvent = eventType.replace(/[\r\n]/g, "");

	if (!isKnownOrderEvent(eventType)) {
		console.log(`[Webhook/Saleor] Ignoring unhandled event: ${safeEvent}`);
		return Response.json({ received: true, event: eventType, handled: false });
	}

	switch (eventType) {
		case "ORDER_CREATED":
			console.log(
				`[Webhook/Saleor] ORDER_CREATED — order #${safeOrderNumber} (${safeOrderId})`,
			);
			if (orderData?.id) {
				await propagateIntentToOrder(orderData.id);
			}
			break;

		case "ORDER_FULFILLED":
			console.log(
				`[Webhook/Saleor] ORDER_FULFILLED — order #${safeOrderNumber} (${safeOrderId}) status: ${orderData?.status ?? "unknown"}`,
			);
			break;

		case "ORDER_CANCELLED":
			console.log(
				`[Webhook/Saleor] ORDER_CANCELLED — order #${safeOrderNumber} (${safeOrderId})`,
			);
			break;

		case "ORDER_PAID":
			console.log(
				`[Webhook/Saleor] ORDER_PAID — order #${safeOrderNumber} (${safeOrderId}) isPaid: ${orderData?.isPaid ?? "unknown"}`,
			);
			break;

		case "ORDER_REFUNDED":
			console.log(
				`[Webhook/Saleor] ORDER_REFUNDED — order #${safeOrderNumber} (${safeOrderId})`,
			);
			if (orderData?.id) {
				const pending = findPendingReturnForOrder(orderData.id);
				if (pending) {
					updateReturnStatus(pending.id, "refunded");
					console.log(
						`[Webhook/Saleor] return ${pending.id} → refunded (order ${safeOrderId})`,
					);
				}
			}
			break;

		case "ORDER_RETURN_REQUESTED":
			// Surfaced when the merchant initiates a return from Saleor admin.
			// We don't auto-create an agent return record (no agent context),
			// but we log so the audit trail is complete.
			console.log(
				`[Webhook/Saleor] ORDER_RETURN_REQUESTED — order #${safeOrderNumber} (${safeOrderId})`,
			);
			break;
	}

	return Response.json({
		received: true,
		event: eventType,
		order_id: orderId,
		handled: true,
	});
}
