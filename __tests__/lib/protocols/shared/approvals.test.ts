import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildApprovalUrl,
	createPendingApproval,
	getApprovalStatus,
	requiresApproval,
	_resetApprovalsState,
} from "@/lib/protocols/shared/approvals";

describe("requiresApproval", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns false when APPROVAL_THRESHOLD_CENTS is not set", () => {
		vi.stubEnv("APPROVAL_THRESHOLD_CENTS", "");
		expect(requiresApproval(1_000_000)).toBe(false);
	});

	it("returns false when APPROVAL_THRESHOLD_CENTS is non-numeric", () => {
		vi.stubEnv("APPROVAL_THRESHOLD_CENTS", "not-a-number");
		expect(requiresApproval(1_000_000)).toBe(false);
	});

	it("returns false at exactly the threshold (strictly greater)", () => {
		vi.stubEnv("APPROVAL_THRESHOLD_CENTS", "10000");
		expect(requiresApproval(10_000)).toBe(false);
	});

	it("returns true above the threshold", () => {
		vi.stubEnv("APPROVAL_THRESHOLD_CENTS", "10000");
		expect(requiresApproval(10_001)).toBe(true);
	});

	it("returns false for non-positive thresholds (treated as disabled)", () => {
		vi.stubEnv("APPROVAL_THRESHOLD_CENTS", "0");
		expect(requiresApproval(1_000_000)).toBe(false);
		vi.stubEnv("APPROVAL_THRESHOLD_CENTS", "-100");
		expect(requiresApproval(1_000_000)).toBe(false);
	});
});

describe("createPendingApproval / getApprovalStatus", () => {
	const log = vi.spyOn(console, "log").mockImplementation(() => {});

	afterEach(() => {
		_resetApprovalsState();
		log.mockClear();
		vi.unstubAllEnvs();
	});

	it("returns a record with id, expires_at, and status='pending'", async () => {
		vi.stubEnv("PAYLOAD_API_URL", "");
		const approval = await createPendingApproval({
			agent_id: "openai-test",
			action: "checkout.complete",
			resource_id: "ck_1",
			amount_cents: 50_000,
			reason: "over cap",
		});
		expect(approval.id).toMatch(/^appr_[0-9a-f]{32}$/);
		expect(approval.status).toBe("pending");
		expect(approval.expires_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it("getApprovalStatus returns the same record for a known id", async () => {
		vi.stubEnv("PAYLOAD_API_URL", "");
		const created = await createPendingApproval({
			agent_id: "a",
			action: "x",
			resource_id: "r",
			amount_cents: 100,
			reason: "test",
		});
		const fetched = await getApprovalStatus(created.id);
		expect(fetched).not.toBeNull();
		expect(fetched?.id).toBe(created.id);
	});

	it("getApprovalStatus returns null for unknown id", async () => {
		vi.stubEnv("PAYLOAD_API_URL", "");
		expect(await getApprovalStatus("appr_nonexistent")).toBeNull();
	});

	it("auto-flips to expired once expires_at passes", async () => {
		vi.stubEnv("PAYLOAD_API_URL", "");
		const created = await createPendingApproval({
			agent_id: "a",
			action: "x",
			resource_id: "r",
			amount_cents: 100,
			reason: "test",
			ttl_ms: 1, // expire effectively immediately
		});
		await new Promise((resolve) => setTimeout(resolve, 5));
		const fetched = await getApprovalStatus(created.id);
		expect(fetched?.status).toBe("expired");
	});

	it("logs a [approval] line on creation", async () => {
		vi.stubEnv("PAYLOAD_API_URL", "");
		await createPendingApproval({
			agent_id: "openai",
			action: "checkout.complete",
			resource_id: "ck_2",
			amount_cents: 12345,
			reason: "test",
		});
		expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[approval\] pending /));
	});
});

describe("buildApprovalUrl", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("builds an absolute URL using NEXT_PUBLIC_STOREFRONT_URL", () => {
		vi.stubEnv("NEXT_PUBLIC_STOREFRONT_URL", "https://store.example");
		expect(buildApprovalUrl("appr_xyz")).toBe(
			"https://store.example/api/ucp/rest/approvals/appr_xyz",
		);
	});

	it("falls back to localhost when STOREFRONT_URL is not set", () => {
		vi.stubEnv("NEXT_PUBLIC_STOREFRONT_URL", "");
		expect(buildApprovalUrl("appr_xyz")).toBe(
			"http://localhost:3000/api/ucp/rest/approvals/appr_xyz",
		);
	});

	it("URL-encodes the id (defense against path injection)", () => {
		vi.stubEnv("NEXT_PUBLIC_STOREFRONT_URL", "https://x");
		const url = buildApprovalUrl("appr/with/slashes");
		expect(url).toContain("appr%2Fwith%2Fslashes");
	});
});
