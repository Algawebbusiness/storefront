/**
 * Unit test for triggerSaleorRefund.
 *
 * Stubs `fetch` so we don't hit a real Saleor instance; covers the three
 * outcomes that matter to the route handler: success, GraphQL error, and
 * unconfigured environment.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { triggerSaleorRefund } from "@/lib/protocols/shared/return-queries";

describe("triggerSaleorRefund", () => {
	const fetchSpy = vi.spyOn(globalThis, "fetch");

	beforeEach(() => {
		fetchSpy.mockReset();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns ok with the post-refund order status when Saleor accepts", async () => {
		vi.stubEnv("NEXT_PUBLIC_SALEOR_API_URL", "https://saleor.example/graphql/");
		vi.stubEnv("SALEOR_APP_TOKEN", "admin-token");
		fetchSpy.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					data: {
						orderRefund: {
							order: { id: "ord_1", status: "PARTIALLY_REFUNDED" },
							errors: [],
						},
					},
				}),
				{ status: 200 },
			),
		);

		const out = await triggerSaleorRefund({ orderId: "ord_1", amountMajorUnits: 100 });
		expect(out.ok).toBe(true);
		if (out.ok) expect(out.orderStatus).toBe("PARTIALLY_REFUNDED");
	});

	it("returns ok=false with the joined error message when Saleor responds with mutation errors", async () => {
		vi.stubEnv("NEXT_PUBLIC_SALEOR_API_URL", "https://saleor.example/graphql/");
		vi.stubEnv("SALEOR_APP_TOKEN", "admin-token");
		fetchSpy.mockResolvedValueOnce(
			new Response(
				JSON.stringify({
					data: {
						orderRefund: {
							order: null,
							errors: [{ field: "amount", message: "Cannot refund more than was paid", code: "INVALID" }],
						},
					},
				}),
				{ status: 200 },
			),
		);

		const out = await triggerSaleorRefund({ orderId: "ord_1", amountMajorUnits: 100 });
		expect(out.ok).toBe(false);
		if (!out.ok) expect(out.reason).toMatch(/Cannot refund/);
	});

	it("returns ok=false with reason `unconfigured` when admin token is missing", async () => {
		vi.stubEnv("NEXT_PUBLIC_SALEOR_API_URL", "");
		vi.stubEnv("SALEOR_APP_TOKEN", "");
		const out = await triggerSaleorRefund({ orderId: "ord_1", amountMajorUnits: 100 });
		expect(out.ok).toBe(false);
		if (!out.ok) expect(out.reason).toBe("unconfigured");
	});
});
