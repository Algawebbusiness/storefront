/**
 * Payload collection template — `AgentPendingApprovals` (Phase B6).
 *
 * **TEMPLATE.** Mirrors `PendingApproval` in
 * `src/lib/protocols/shared/approvals.ts`.
 *
 * Two-step UX in the Payload admin:
 *   1. Merchant sees a list filtered to `status=pending`, sorted by
 *      `created_at desc`.
 *   2. Click into a row → "Approve" / "Reject" buttons (custom field
 *      hooks live in the Payload deploy, not here).
 *
 * The agent polls `GET /api/ucp/rest/approvals/:id` (B6 storefront route)
 * which reads this collection.
 */

interface CollectionConfig {
	slug: string;
	admin?: { useAsTitle?: string; description?: string; defaultColumns?: string[] };
	access?: Record<string, unknown>;
	fields: Array<Record<string, unknown>>;
	timestamps?: boolean;
}

export const AgentPendingApprovals: CollectionConfig = {
	slug: "agent-pending-approvals",
	admin: {
		useAsTitle: "id",
		description:
			"Agent požaduje schválení akce nad tvým limitem. Schvaluj/odmítej co rychle umíš — agent čeká.",
		defaultColumns: ["id", "agent_id", "action", "amount_cents", "status", "expires_at"],
	},
	timestamps: true,
	fields: [
		{ name: "id", type: "text", required: true, unique: true, index: true },
		{ name: "agent_id", type: "text", required: true, index: true },
		{ name: "action", type: "text", required: true },
		{ name: "resource_id", type: "text", required: true },
		{ name: "amount_cents", type: "number" },
		{ name: "reason", type: "textarea", required: true },
		{
			name: "status",
			type: "select",
			required: true,
			defaultValue: "pending",
			options: ["pending", "approved", "rejected", "expired"],
			index: true,
		},
		{ name: "expires_at", type: "date", required: true },
		{ name: "created_at", type: "date", required: true },
		{ name: "approved_by", type: "text" },
		{ name: "approved_at", type: "date" },
	],
};
