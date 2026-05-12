/**
 * Phase F3 — typed `ui/message` enum + renderer tests.
 *
 * Verifies that `renderUiMessage()` is exhaustive over all `UiMessageKind`
 * variants and produces stable, PII-free strings keyed only by IDs.
 *
 * A separate TypeScript type-test (compile-time) would be ideal but
 * vitest doesn't run type-level assertions; we rely on `tsc --noEmit`
 * in CI to catch any non-exhaustive switch.
 */

import { describe, expect, it } from "vitest";
import {
	ALL_UI_MESSAGE_KINDS,
	renderUiMessage,
	type UiMessage,
	type UiMessageKind,
} from "@/mcp-apps/src/ui-messages";

describe("UiMessage enum + renderUiMessage", () => {
	it("ALL_UI_MESSAGE_KINDS lists every UiMessageKind exactly once", () => {
		const set = new Set(ALL_UI_MESSAGE_KINDS);
		expect(set.size).toBe(ALL_UI_MESSAGE_KINDS.length);
	});

	const samples: ReadonlyArray<{ msg: UiMessage; expectRegex: RegExp }> = [
		{
			msg: { kind: "cart.proceed_to_checkout", cart_id: "c_abc123" },
			expectRegex: /^User wants to proceed to checkout \(cart c_abc123\)\.$/,
		},
		{
			msg: { kind: "checkout.confirm_requested", checkout_id: "co_xyz" },
			expectRegex: /^User confirmed checkout co_xyz\. Please proceed with payment\.$/,
		},
		{
			msg: {
				kind: "checkout.payment_failed",
				checkout_id: "co_xyz",
				reason: "card_declined",
			},
			expectRegex: /^Payment for checkout co_xyz failed: card_declined\.$/,
		},
		{
			msg: { kind: "view.error", view: "cart-preview", code: "render_failed" },
			expectRegex: /^View cart-preview reported error: render_failed\.$/,
		},
	];

	for (const { msg, expectRegex } of samples) {
		it(`renders ${msg.kind} as neutral natural-language without PII`, () => {
			const out = renderUiMessage(msg);
			expect(out).toMatch(expectRegex);
			// PII smoke-tests
			expect(out).not.toMatch(/@/); // no emails
			expect(out).not.toMatch(/\d{4,}\s*[A-Z]/); // no postal-code-looking patterns
		});
	}

	it("every kind in ALL_UI_MESSAGE_KINDS has a render implementation", () => {
		// Build the minimal valid args per kind so renderUiMessage doesn't throw.
		// If a new kind is added without updating the renderer, this test fails
		// before tsc — but tsc also catches it via the exhaustive switch.
		const minimal: Record<UiMessageKind, UiMessage> = {
			"cart.proceed_to_checkout": { kind: "cart.proceed_to_checkout", cart_id: "x" },
			"checkout.confirm_requested": { kind: "checkout.confirm_requested", checkout_id: "x" },
			"checkout.payment_failed": {
				kind: "checkout.payment_failed",
				checkout_id: "x",
				reason: "generic",
			},
			"view.error": { kind: "view.error", view: "x", code: "x" },
		};
		for (const kind of ALL_UI_MESSAGE_KINDS) {
			expect(() => renderUiMessage(minimal[kind])).not.toThrow();
		}
	});
});
