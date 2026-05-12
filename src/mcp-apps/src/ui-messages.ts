/**
 * Typed-enum contract for `ui/message` payloads (Phase F3).
 *
 * Background: `ui/message` (spec method `"ui/message"`) sends a chat
 * message from the iframe to the host. Hosts typically inject the
 * message into the model's conversation context — so anything an
 * iframe puts in here lands in the LLM's reasoning surface.
 *
 * To prevent the iframe from smuggling PII (addresses, totals, emails)
 * into model context via a free-form string, the bridge exposes
 * `sendUiMessage(msg)` that only accepts this typed enum. The actual
 * natural-language text is **server-rendered** from `kind` + IDs by
 * `renderUiMessage()` — iframe never controls the string content.
 *
 * Adding a new kind:
 *   1. Append a variant to the `UiMessage` union with safe ID-only fields.
 *   2. Add a case to `renderUiMessage()` — TypeScript's exhaustive
 *      switch enforces it (the function returns `string`, missing a
 *      case is a type error).
 *   3. Update threat-model doc with the new line.
 */

/** All recognised `kind` discriminator values. */
export type UiMessageKind =
	| "cart.proceed_to_checkout"
	| "checkout.confirm_requested"
	| "checkout.payment_failed"
	| "view.error";

/** Discriminated union of every typed UI message variant. */
export type UiMessage =
	| {
			kind: "cart.proceed_to_checkout";
			cart_id: string;
	  }
	| {
			kind: "checkout.confirm_requested";
			checkout_id: string;
	  }
	| {
			kind: "checkout.payment_failed";
			checkout_id: string;
			reason: "card_declined" | "timeout" | "generic";
	  }
	| {
			kind: "view.error";
			view: string;
			code: string;
	  };

/**
 * Render a typed message to the neutral natural-language string that
 * actually goes to the host. The iframe doesn't control the wording —
 * it picks a `kind` and supplies a small set of safe IDs.
 *
 * Exhaustive over `UiMessageKind` — adding a new variant to `UiMessage`
 * without a matching case here is a TypeScript error (the switch falls
 * through to `never`).
 */
export function renderUiMessage(msg: UiMessage): string {
	switch (msg.kind) {
		case "cart.proceed_to_checkout":
			return `User wants to proceed to checkout (cart ${msg.cart_id}).`;
		case "checkout.confirm_requested":
			return `User confirmed checkout ${msg.checkout_id}. Please proceed with payment.`;
		case "checkout.payment_failed":
			return `Payment for checkout ${msg.checkout_id} failed: ${msg.reason}.`;
		case "view.error":
			return `View ${msg.view} reported error: ${msg.code}.`;
		default: {
			const _exhaustive: never = msg;
			throw new Error(`Unhandled UiMessage kind: ${JSON.stringify(_exhaustive)}`);
		}
	}
}

/**
 * Compile-time guard helper. Lets server code (e.g. tests) assert that
 * a string is a known `UiMessageKind` without re-importing the union.
 */
export const ALL_UI_MESSAGE_KINDS: readonly UiMessageKind[] = [
	"cart.proceed_to_checkout",
	"checkout.confirm_requested",
	"checkout.payment_failed",
	"view.error",
];
