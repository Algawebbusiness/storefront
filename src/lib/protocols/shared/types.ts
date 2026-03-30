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

/** Checkout totals in protocol format */
export interface ProtocolTotals {
	subtotal: ProtocolMoney;
	tax: ProtocolMoney;
	shipping: ProtocolMoney;
	discount: ProtocolMoney;
	total: ProtocolMoney;
}

/** Result of agent authentication */
export interface AgentAuthResult {
	valid: boolean;
	agentId?: string;
	profileUrl?: string; // UCP agent profile URL
}
