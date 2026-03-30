/**
 * ACP (Agentic Commerce Protocol) types.
 *
 * Based on: https://agenticcommerce.dev/docs
 * Spec version: 2026-01-30
 */

import type { ProtocolMoney, ProtocolTotals, CheckoutStatus } from "../shared/types";

/** ACP product feed item */
export interface AcpProduct {
	id: string;
	title: string;
	description: string | null;
	url: string;
	image_url: string | null;
	price: ProtocolMoney;
	availability: "in_stock" | "out_of_stock" | "preorder";
	sku?: string | null;
	gtin?: string | null;
	mpn?: string | null;
	brand?: string | null;
	category?: string | null;
	variants: AcpVariant[];
	updated_at: string;
}

/** ACP product variant */
export interface AcpVariant {
	id: string;
	name: string;
	sku: string | null;
	price: ProtocolMoney;
	availability: "in_stock" | "out_of_stock";
	attributes: Record<string, string>;
}

/** ACP checkout session (for Phase 2+) */
export interface AcpCheckoutSession {
	id: string;
	status: CheckoutStatus;
	line_items: AcpLineItem[];
	totals: ProtocolTotals;
	available_shipping_methods: AcpShippingMethod[];
	payment_methods: AcpPaymentMethod[];
	continue_url: string;
}

export interface AcpLineItem {
	product_id: string;
	variant_id: string;
	name: string;
	quantity: number;
	unit_price: ProtocolMoney;
	image_url?: string;
}

export interface AcpShippingMethod {
	id: string;
	name: string;
	price: ProtocolMoney;
	estimated_days?: number;
}

export interface AcpPaymentMethod {
	type: string;
	config?: Record<string, string>;
}
