/**
 * UCP REST — Approval status polling (Phase B6).
 *
 * GET /api/ucp/rest/approvals/:id
 *
 * Agent polls this when a previous mutating call returned 202 with an
 * `approval_url`. Response is signed (UCP-Signature) like every other
 * /api/ucp/rest/* route. Status auto-flips to `expired` when the merchant
 * hasn't acted by `expires_at`.
 */

import { verifyAgentRequest } from "@/lib/protocols/shared/auth";
import { signedJsonResponse, signedProtocolDisabled } from "@/lib/protocols/shared/response";
import { getApprovalStatus } from "@/lib/protocols/shared/approvals";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	if (process.env.UCP_ENABLED !== "true") {
		return signedProtocolDisabled("UCP");
	}

	const verify = await verifyAgentRequest(request);
	if (!verify.ok) {
		return signedJsonResponse(
			{ error: { code: verify.status === 403 ? "forbidden" : "unauthorized", message: verify.reason } },
			{ status: verify.status },
		);
	}

	const { id } = await params;
	const approval = await getApprovalStatus(id);
	// SECURITY (IDOR, CWE-639): only the agent that created the approval may poll
	// it. 404 (not 403) to a non-owner so the approval's existence isn't leaked.
	if (!approval || approval.agent_id !== verify.agent.id) {
		return signedJsonResponse(
			{ error: { code: "not_found", message: `Approval ${id} not found` } },
			{ status: 404 },
		);
	}

	const ucpMeta = await buildUcpMeta(verify.profileUrl);
	return signedJsonResponse({
		ucp: ucpMeta,
		approval: {
			id: approval.id,
			status: approval.status,
			action: approval.action,
			resource_id: approval.resource_id,
			amount_cents: approval.amount_cents,
			expires_at: approval.expires_at,
		},
	});
}
