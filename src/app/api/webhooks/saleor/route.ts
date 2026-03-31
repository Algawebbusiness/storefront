/**
 * Saleor webhook handler for order events.
 *
 * POST /api/webhooks/saleor
 *
 * Handles ORDER_CREATED, ORDER_FULFILLED, ORDER_CANCELLED, ORDER_PAID events.
 * Verifies HMAC signature from Saleor-Signature header when SALEOR_WEBHOOK_SECRET is set.
 */

import { createHmac, timingSafeEqual } from "crypto";

const WEBHOOK_SECRET = process.env.SALEOR_WEBHOOK_SECRET;

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
	| "ORDER_PAID";

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
	}

	return Response.json({
		received: true,
		event: eventType,
		order_id: orderId,
		handled: true,
	});
}
