/**
 * Loyalty / gift-card / voucher mapping for the C10 UCP loyalty capability.
 *
 * Saleor exposes `checkoutAddPromoCode` and `checkoutRemovePromoCode` — both
 * accept the same string regardless of whether it's a voucher code or a gift
 * card. The mapper unifies the agent-facing payload around a single
 * `{ code }` shape and translates Saleor errors into UCP error codes.
 *
 * Loyalty points (customer-loyalty-program style) are out of scope for C10
 * — Saleor doesn't ship native loyalty; a tenant-specific voucher with a
 * pre-computed value handles that case until Phase E.
 */

import { signedJsonResponse } from "./response";
import {
	CHECKOUT_ADD_PROMO_CODE_MUTATION,
	CHECKOUT_REMOVE_PROMO_CODE_MUTATION,
	type CheckoutAddPromoCodeData,
	type CheckoutRemovePromoCodeData,
	type SaleorCheckout,
} from "./checkout-queries";
import { saleorQuery } from "@/mcp-server/saleor-client";

export type LoyaltyApplyOutcome =
	| { ok: true; checkout: SaleorCheckout }
	| { ok: false; response: Response };

/**
 * Apply a promo code (gift card or voucher) to a cart. Returns a discriminated
 * outcome — on failure the caller can return the pre-built signed Response
 * directly without re-wrapping the error.
 */
export async function applyLoyaltyCode(
	checkoutId: string,
	code: string,
): Promise<LoyaltyApplyOutcome> {
	const result = await saleorQuery<CheckoutAddPromoCodeData>(CHECKOUT_ADD_PROMO_CODE_MUTATION, {
		checkoutId,
		promoCode: code,
	});

	if (!result.ok) {
		return {
			ok: false,
			response: await signedJsonResponse(
				{ error: { code: "server_error", message: result.error } },
				{ status: 500 },
			),
		};
	}

	const data = result.data.checkoutAddPromoCode;
	if (data.errors.length > 0) {
		const message = data.errors.map((e) => e.message).join("; ");
		const errCode = inferPromoErrorCode(message);
		return {
			ok: false,
			response: await signedJsonResponse(
				{ error: { code: errCode, message } },
				{ status: 400 },
			),
		};
	}

	if (!data.checkout) {
		return {
			ok: false,
			response: await signedJsonResponse(
				{ error: { code: "not_found", message: "Cart not found" } },
				{ status: 404 },
			),
		};
	}

	return { ok: true, checkout: data.checkout };
}

export type LoyaltyRemoveOutcome =
	| { ok: true; checkout: SaleorCheckout }
	| { ok: false; response: Response };

/** Remove a previously applied promo code. */
export async function removeLoyaltyCode(
	checkoutId: string,
	code: string,
): Promise<LoyaltyRemoveOutcome> {
	const result = await saleorQuery<CheckoutRemovePromoCodeData>(
		CHECKOUT_REMOVE_PROMO_CODE_MUTATION,
		{ checkoutId, promoCode: code },
	);

	if (!result.ok) {
		return {
			ok: false,
			response: await signedJsonResponse(
				{ error: { code: "server_error", message: result.error } },
				{ status: 500 },
			),
		};
	}

	const data = result.data.checkoutRemovePromoCode;
	if (!data.checkout) {
		return {
			ok: false,
			response: await signedJsonResponse(
				{ error: { code: "not_found", message: "Cart not found" } },
				{ status: 404 },
			),
		};
	}

	return { ok: true, checkout: data.checkout };
}

/**
 * Best-effort mapping from a Saleor error message to a UCP error code. The
 * codes are stable so the agent can act on them programmatically.
 */
function inferPromoErrorCode(message: string): string {
	const lower = message.toLowerCase();
	if (lower.includes("not valid") || lower.includes("invalid")) return "invalid_code";
	if (lower.includes("expired")) return "expired_code";
	if (lower.includes("not active") || lower.includes("inactive")) return "inactive_code";
	return "bad_request";
}
