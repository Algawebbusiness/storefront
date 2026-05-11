/**
 * Payload collection template — `AgentActivity` (Phase B4).
 *
 * **TEMPLATE.** Never imported by storefront runtime. Mirrors
 * `AgentActivityEntry` in `src/lib/protocols/shared/agent-log.ts`.
 *
 * Multi-tenant plugin auto-adds `tenant`. Each merchant sees only their
 * own activity rows in the admin.
 *
 * Retention: collection lives without TTL by default. Phase E3
 * (observability) ships an archival cron that moves rows older than 90
 * days into a separate `agent-activity-archive` collection or external
 * cold store.
 */

interface CollectionConfig {
	slug: string;
	admin?: { useAsTitle?: string; description?: string; defaultColumns?: string[] };
	access?: Record<string, unknown>;
	fields: Array<Record<string, unknown>>;
	timestamps?: boolean;
}

export const AgentActivity: CollectionConfig = {
	slug: "agent-activity",
	admin: {
		useAsTitle: "action",
		description: "Audit log: kdo, co, kdy, výsledek. Naplňuje storefront, klient jen čte.",
		defaultColumns: ["created_at", "agent_id", "action", "status", "amount_cents"],
	},
	access: {
		// Read-only from the admin UI; writes come from the storefront REST endpoint.
		create: () => false,
		update: () => false,
		delete: () => false,
	},
	timestamps: true,
	fields: [
		{ name: "agent_id", type: "text", required: true, index: true },
		{ name: "action", type: "text", required: true, index: true },
		{ name: "scope", type: "text" },
		{ name: "resource_id", type: "text", index: true },
		{ name: "request_summary", type: "textarea" },
		{
			name: "status",
			type: "select",
			required: true,
			options: ["success", "denied", "error"],
		},
		{ name: "status_code", type: "number", required: true },
		{ name: "duration_ms", type: "number", required: true },
		{ name: "amount_cents", type: "number" },
		{ name: "ip", type: "text" },
		{ name: "user_agent", type: "text" },
		{ name: "created_at", type: "date", required: true, index: true },
	],
};
