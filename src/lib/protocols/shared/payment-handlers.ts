/**
 * Payment handler registry (Phase C6).
 *
 * UCP `payment_handlers` is keyed by handler ID (`com.stripe.shared_payment_token`,
 * `com.stripe.link_agent_wallet`, …) and maps to a list of `UcpPaymentHandler`
 * entries. Before C6 the profile builder hard-coded the Stripe SPT entry; now
 * each handler self-registers via this registry and the builder composes the
 * payment_handlers section by iterating registered definitions.
 *
 * Design:
 *   - **Registration via side effect.** Handlers live in
 *     `src/lib/protocols/handlers/<id>.ts` and call `registerPaymentHandler`
 *     at module load. The profile builder imports the barrel
 *     `protocols/handlers` for the side effect.
 *   - **build() returns null when unconfigured.** A handler whose env vars
 *     aren't set drops out of the profile entirely instead of advertising
 *     a half-broken capability.
 *   - **Idempotent registration.** Re-importing the handler module (HMR,
 *     test rewinds) is fine — the registry replaces an existing entry with
 *     the same `id`. Tests can also call `_resetPaymentHandlerRegistry`.
 */

import type { UcpPaymentHandler } from "../ucp/types";

export interface PaymentHandlerDefinition {
	/** UCP handler ID, e.g. `com.stripe.shared_payment_token`. */
	id: string;
	/**
	 * Builder function. Reads env at call time so .env reloads / per-tenant
	 * deploys produce correct output. Return `null` when the handler is not
	 * configured (e.g. STRIPE_PUBLISHABLE_KEY missing) — the profile then
	 * omits the entry entirely rather than advertising an unusable handler.
	 */
	build: () => UcpPaymentHandler[] | null;
}

const handlers = new Map<string, PaymentHandlerDefinition>();

/**
 * Register or replace a handler. The registry is keyed by `id`, so the same
 * handler module re-importing itself (HMR, test rewinds) doesn't duplicate.
 */
export function registerPaymentHandler(definition: PaymentHandlerDefinition): void {
	handlers.set(definition.id, definition);
}

/**
 * Compose the `payment_handlers` block for the public profile. Skips any
 * handler whose `build()` returns `null` or an empty array.
 */
export function buildPaymentHandlersForProfile(): Record<string, UcpPaymentHandler[]> {
	const out: Record<string, UcpPaymentHandler[]> = {};
	for (const def of handlers.values()) {
		const entries = def.build();
		if (entries && entries.length > 0) {
			out[def.id] = entries;
		}
	}
	return out;
}

/** List the registered handler IDs in deterministic insertion order. */
export function listRegisteredPaymentHandlers(): string[] {
	return Array.from(handlers.keys());
}

/** Test helper — wipe the registry so a new set of handlers can register. */
export function _resetPaymentHandlerRegistry(): void {
	handlers.clear();
}
