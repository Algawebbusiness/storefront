/**
 * Shared types for ACP and UCP agentic commerce protocols.
 */

/** Money in protocol format (minor units / cents) */
export interface ProtocolMoney {
	amount: number;
	currency: string;
}

/** Saleor money format (decimal amounts) */
export interface SaleorMoney {
	amount: number;
	currency: string;
}

/** Protocol-standard address format (used by both ACP and UCP) */
export interface ProtocolAddress {
	street_address: string;
	street_address_2?: string;
	address_locality: string; // city
	address_region?: string; // state/province
	postal_code: string;
	address_country: string; // ISO 3166-1 alpha-2
}

/** Saleor address format */
export interface SaleorAddress {
	firstName?: string;
	lastName?: string;
	companyName?: string;
	streetAddress1: string;
	streetAddress2?: string;
	city: string;
	cityArea?: string;
	postalCode: string;
	country: string; // ISO 3166-1 alpha-2 (e.g., "CZ")
	countryArea?: string;
	phone?: string;
}

/** Checkout status shared across both protocols */
export type CheckoutStatus =
	| "incomplete"
	| "ready_for_payment"
	| "requires_escalation"
	| "completed"
	| "failed"
	| "cancelled";

/** Line item in protocol format */
export interface ProtocolLineItem {
	product_id: string;
	variant_id: string;
	name: string;
	quantity: number;
	unit_price: ProtocolMoney;
	total_price: ProtocolMoney;
	image_url?: string;
}

/**
 * Legacy nested totals shape used by ACP (`2026-01-30` spec) and a few internal
 * call sites. New code should prefer `UcpTotals` (Phase A8).
 */
export interface ProtocolTotals {
	subtotal: ProtocolMoney;
	tax: ProtocolMoney;
	shipping: ProtocolMoney;
	discount: ProtocolMoney;
	total: ProtocolMoney;
}

/**
 * UCP 2026-04-08 totals contract (Phase A8).
 *
 * Flat integer-cents structure with mandatory ISO 4217 currency at the top.
 * Supersedes the nested `ProtocolTotals` shape on UCP order/checkout responses.
 *
 * `breakdown[]` carries optional per-line tax/discount detail when the
 * merchant has the data; agents must tolerate it being absent.
 */
export interface UcpTotals {
	currency: string;
	subtotal_cents: number;
	discount_cents: number;
	shipping_cents: number;
	tax_cents: number;
	total_cents: number;
	breakdown?: UcpTotalsBreakdown[];
}

export interface UcpTotalsBreakdown {
	line_id: string;
	tax_cents?: number;
	discount_cents?: number;
}

/**
 * Agent-supplied context attached to cart / checkout / order (Phase A7).
 *
 * Per UCP 2026-04-08 the agent may pass a free-form `intent` string and a
 * structured `buyer_preferences` object. We persist the whole context into
 * Saleor metadata and surface it back in cart/checkout/order responses.
 */
export interface UcpContext {
	/** Free-form intent. Max 500 chars. */
	intent?: string;
	/** Structured preferences. JSON-stringified to ≤2000 chars in metadata. */
	buyer_preferences?: Record<string, unknown>;
	/** Opaque session identifier for audit / log correlation. */
	session_id?: string;
}

/** Result of agent authentication */
export interface AgentAuthResult {
	valid: boolean;
	agentId?: string;
	profileUrl?: string; // UCP agent profile URL
	/** Present when authenticated via OAuth2 (customer-scoped) */
	userContext?: {
		userId: string;
		email: string;
		scope: string;
		saleorToken: string;
	};
}
