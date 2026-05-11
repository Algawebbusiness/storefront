/**
 * Payload collection template — `Agents` (Phase B2).
 *
 * **This file is a TEMPLATE.** It is never imported by the storefront runtime.
 * It lives here so that when the Algaweb Payload CMS deployment ships, the
 * collection definition is ready to be copied into that repo's
 * `payload.config.ts`.
 *
 * The storefront reads agent records via `src/lib/protocols/shared/agent-registry.ts`,
 * which queries Payload over REST when `PAYLOAD_API_URL` is set and falls
 * back to the `AGENT_REGISTRY_JSON` env var otherwise. The shape declared
 * here MUST match `AgentIdentity` in `agent-registry-types.ts` — when you
 * change one, change the other.
 *
 * Multi-tenancy: the multi-tenant plugin auto-adds a `tenant` field to every
 * collection, so each merchant sees only their own agents. No need to
 * declare it here.
 */

// Note: imports below are commented out because Payload is not a dependency
// of the storefront. Uncomment when copying this file into the Payload repo.
//
// import type { CollectionConfig } from "payload/types";

interface CollectionConfig {
	slug: string;
	admin?: { useAsTitle?: string; description?: string; defaultColumns?: string[] };
	access?: Record<string, unknown>;
	fields: Array<Record<string, unknown>>;
	timestamps?: boolean;
}

export const Agents: CollectionConfig = {
	slug: "agents",
	admin: {
		useAsTitle: "display_name",
		description:
			"AI agenti, kteří mohou nakupovat z tohoto e-shopu. Spravuj scope, spending caps, rate limits a status.",
		defaultColumns: ["display_name", "platform", "status", "id"],
	},
	timestamps: true,
	fields: [
		{
			name: "id",
			type: "text",
			required: true,
			unique: true,
			admin: {
				description: "Stable slug, e.g. openai-chatgpt-prod. Don't change after issuance.",
			},
		},
		{
			name: "display_name",
			type: "text",
			required: true,
			admin: { description: "Human-readable name shown in OAuth consent and audit logs." },
		},
		{
			name: "platform",
			type: "select",
			required: true,
			options: [
				{ label: "OpenAI (ChatGPT)", value: "openai" },
				{ label: "Google (Gemini)", value: "google" },
				{ label: "Anthropic (Claude)", value: "anthropic" },
				{ label: "Microsoft (Copilot)", value: "microsoft" },
				{ label: "Custom / Internal", value: "custom" },
			],
		},
		{
			name: "status",
			type: "select",
			required: true,
			defaultValue: "active",
			options: [
				{ label: "Active", value: "active" },
				{ label: "Suspended (reversible)", value: "suspended" },
				{ label: "Revoked (terminal)", value: "revoked" },
			],
		},
		{
			name: "public_key",
			type: "textarea",
			required: true,
			admin: {
				description:
					"Base64-encoded raw 32-byte ed25519 public key. Used to verify UCP-Signature on incoming requests.",
			},
		},
		{
			name: "scope",
			type: "select",
			hasMany: true,
			required: true,
			options: [
				{ label: "Read catalog", value: "catalog.read" },
				{ label: "Create cart", value: "cart.create" },
				{ label: "Update cart", value: "cart.update" },
				{ label: "Create checkout-session", value: "checkout.create" },
				{ label: "Complete checkout (PAYS!)", value: "checkout.complete" },
				{ label: "Read orders", value: "order.read" },
				{ label: "Initiate returns", value: "order.return" },
				{ label: "Read customer (OAuth only)", value: "customer.read" },
				{ label: "Update customer (OAuth only)", value: "customer.update" },
			],
		},
		{
			name: "spending_limit",
			type: "group",
			fields: [
				{
					name: "per_session_cents",
					type: "number",
					admin: { description: "Per-checkout cap in minor units (cents). Empty = unlimited." },
				},
				{
					name: "per_day_cents",
					type: "number",
					admin: { description: "24h rolling cap in minor units. Empty = unlimited." },
				},
				{
					name: "per_month_cents",
					type: "number",
					admin: { description: "Calendar-month cap in minor units. Empty = unlimited." },
				},
			],
		},
		{
			name: "rate_limit",
			type: "group",
			fields: [
				{
					name: "requests_per_minute",
					type: "number",
					required: true,
					defaultValue: 30,
				},
				{
					name: "sessions_per_day",
					type: "number",
					required: true,
					defaultValue: 1000,
				},
			],
		},
		{
			name: "contact_email",
			type: "email",
			admin: { description: "For abuse reports and platform notifications." },
		},
		{
			name: "notes",
			type: "textarea",
			admin: { description: "Internal notes — not exposed via API." },
		},
	],
};
