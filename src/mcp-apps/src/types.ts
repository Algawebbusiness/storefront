/**
 * Shared payload types for MCP Apps views (Phase F2 placeholder).
 *
 * F4–F7 fill these in with real `ProductListPayload`, `CartPreviewPayload`,
 * `CheckoutSummaryPayload`, `OrderReceiptPayload` etc. For F2 we only
 * need the umbrella `AppPayload` constraint so the bridge stays typed.
 */

export interface AppPayloadBase {
	/** Discriminator surfaced by the server-side mapper for forward compat. */
	kind: string;
}

export type AppPayload = AppPayloadBase | Record<string, unknown>;
