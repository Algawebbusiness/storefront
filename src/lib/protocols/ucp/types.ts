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

export interface UcpPaymentHandler {
	id: string;
	version: string;
	config: Record<string, string>;
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
