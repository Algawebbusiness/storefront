/**
 * UCP (Universal Commerce Protocol) types.
 *
 * Based on: https://ucp.dev/latest/specification/overview/
 * Spec version: 2026-01-23
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
