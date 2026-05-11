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

import { validateAgentApiKey } from "@/lib/protocols/shared/auth";
import {
	signedJsonResponse,
	signedProtocolDisabled,
	signedUnauthorized,
} from "@/lib/protocols/shared/response";
import { getApprovalStatus } from "@/lib/protocols/shared/approvals";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	if (process.env.UCP_ENABLED !== "true") {
		return signedProtocolDisabled("UCP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return signedUnauthorized();
	}

	const { id } = await params;
	const approval = await getApprovalStatus(id);
	if (!approval) {
		return signedJsonResponse(
			{ error: { code: "not_found", message: `Approval ${id} not found` } },
			{ status: 404 },
		);
	}

	const ucpMeta = await buildUcpMeta(auth.profileUrl);
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
