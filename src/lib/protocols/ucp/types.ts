/**
 * UCP (Universal Commerce Protocol) types.
 *
 * Based on: https://ucp.dev/latest/specification/overview/
 * Spec version: 2026-04-08 (bumped from 2026-01-23 in Phase A2)
 */

/** UCP business profile — served at /.well-known/ucp */
export interface UcpProfile {
	ucp: {
		version: string;
		services: Record<string, UcpService[]>;
		capabilities: Record<string, UcpCapability[]>;
		payment_handlers: Record<string, UcpPaymentHandler[]>;
	};
	signing_keys: UcpSigningKey[];
	/** Phase B8: agent platforms this storefront accepts and trusts. */
	accepted_platforms?: AcceptedPlatform[];
}

/**
 * Public declaration of an agent platform the storefront treats as trusted.
 *
 * Built from the active agent registry (B2): every active `AgentIdentity` is
 * grouped by `platform`, and `public_keys[]` contains the keys of agents on
 * that platform. Agents can use this to discover whether their platform is
 * pre-approved and which key they should sign requests with.
 */
export interface AcceptedPlatform {
	platform: "openai" | "google" | "anthropic" | "microsoft";
	display_name: string;
	trust_level: "verified" | "experimental";
	public_keys: string[];
	contact_url?: string;
}

export interface UcpService {
	version: string;
	spec: string;
	transport: "rest" | "mcp";
	endpoint: string;
	schema: string;
	/**
	 * Per-service error handling policy.
	 *
	 * Added in UCP 2026-04-08. The exact JSON schema for this object lives at
	 * `${UCP_SCHEMA_BASE}/services/error-handling.json` — fields here mirror the
	 * common subset; tighten when validating against the published schema.
	 */
	error_handling?: UcpServiceErrorHandling;
}

export interface UcpServiceErrorHandling {
	retry?: {
		max_attempts?: number;
		backoff?: "exponential" | "linear" | "fixed";
	};
	retryable_status_codes?: number[];
}

export interface UcpCapability {
	version: string;
	spec: string;
	schema: string;
	extends?: string;
}

/**
 * Payment instruments per UCP 2026-04-08 `available_payment_instruments`.
 *
 * Open enum — known values get IntelliSense, but agents may publish strings
 * we don't know about yet (e.g. region-specific schemes). The `string & {}`
 * trick keeps the union open without collapsing literal completion.
 */
export type UcpPaymentInstrument =
	| "card"
	| "card.visa"
	| "card.mastercard"
	| "card.amex"
	| "sepa_debit"
	| "klarna"
	| "affirm"
	| "paypal"
	| "apple_pay"
	| "google_pay"
	| "stablecoin.usdc"
	| "stablecoin.usdg"
	| "wallet.link"
	| (string & {});

/** Configuration block of a UCP payment handler. */
export interface UcpPaymentHandlerConfig {
	publishable_key?: string;
	available_payment_instruments: UcpPaymentInstrument[];
	/**
	 * Wallet provider identifier (e.g. `stripe.link`). Optional; declared by
	 * wallet-style handlers so agents can route credentials to the right
	 * processor without hard-coding the handler id.
	 */
	wallet_provider?: string;
	/**
	 * Stablecoin chains supported when `available_payment_instruments`
	 * carries `stablecoin.*` entries (Phase C8). Free-form lowercase chain
	 * identifiers ("ethereum", "solana", "base").
	 */
	supported_chains?: string[];
	/**
	 * Indicates which Machine Payments Protocol revisions the handler
	 * speaks (Phase C9). Empty / undefined when not an MPP handler.
	 */
	protocols?: string[];
	supports_streaming?: boolean;
	supports_recurring?: boolean;
	supports_micropayments?: boolean;
}

export interface UcpPaymentHandler {
	id: string;
	version: string;
	config: UcpPaymentHandlerConfig;
}

export interface UcpSigningKey {
	kid: string;
	algorithm: string;
	public_key: string;
}

/** UCP response wrapper — every UCP response includes this metadata */
export interface UcpResponseMeta {
	version: string;
	capabilities: Record<string, Array<{ version: string }>>;
}
