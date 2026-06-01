/**
 * Integration tests for /api/ucp/rest/checkout-sessions routes.
 *
 * Covers the migrated create + complete flows and proves the spending cap is
 * enforced by the wrapper *before* any Saleor mutation runs.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockSaleorQuery = vi.fn();

vi.mock("@/mcp-server/saleor-client", () => ({
	saleorQuery: (...args: unknown[]) => mockSaleorQuery(...args),
	getDefaultChannel: () => "default-channel",
}));

const mockProcessStripePayment = vi.fn();

vi.mock("@/lib/protocols/shared/payment", () => ({
	processStripePayment: (...args: unknown[]) => mockProcessStripePayment(...args),
}));

import { POST as createCheckout } from "@/app/api/ucp/rest/checkout-sessions/route";
import { POST as completeCheckout } from "@/app/api/ucp/rest/checkout-sessions/[id]/complete/route";
import { _resetEnvRegistryCache } from "@/lib/protocols/shared/agent-registry";
import { _resetLimitBuckets } from "@/lib/protocols/shared/limits";

function devModeEnv(): void {
	vi.stubEnv("UCP_ENABLED", "true");
	vi.stubEnv("AGENT_API_KEYS", "");
	vi.stubEnv("AGENT_REGISTRY_JSON", "");
	vi.stubEnv("PAYLOAD_API_URL", "");
	vi.stubEnv("APPROVAL_THRESHOLD_CENTS", "");
}

function fakeCheckout(totalAmount: number, id = "co_1") {
	return {
		id,
		email: null,
		channel: { id: "ch", slug: "default-channel" },
		lines: [],
		totalPrice: {
			gross: { amount: totalAmount, currency: "USD" },
			tax: { amount: 0, currency: "USD" },
		},
		subtotalPrice: { gross: { amount: totalAmount, currency: "USD" } },
		shippingPrice: { gross: { amount: 0, currency: "USD" } },
		discount: null,
		shippingAddress: null,
		billingAddress: null,
		deliveryMethod: null,
		shippingMethods: [],
		isShippingRequired: false,
		authorizeStatus: "NONE",
		chargeStatus: "NONE",
		metadata: [],
	};
}

describe("POST /api/ucp/rest/checkout-sessions (integration)", () => {
	beforeEach(() => {
		mockSaleorQuery.mockReset();
		mockProcessStripePayment.mockReset();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		_resetLimitBuckets();
		_resetEnvRegistryCache();
		devModeEnv();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		_resetLimitBuckets();
		_resetEnvRegistryCache();
	});

	it("creates a checkout session via mocked Saleor", async () => {
		mockSaleorQuery.mockResolvedValueOnce({
			ok: true,
			data: { checkoutCreate: { checkout: fakeCheckout(100), errors: [] } },
		});
		// Agent-binding metadata write + refetch (IDOR defense).
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { updateMetadata: { errors: [] } } });
		mockSaleorQuery.mockResolvedValueOnce({ ok: true, data: { checkout: fakeCheckout(100) } });

		const res = await createCheckout(
			new Request("https://store.example/api/ucp/rest/checkout-sessions", {
				method: "POST",
				headers: { Authorization: "Bearer dev-anything", "Content-Type": "application/json" },
				body: JSON.stringify({
					line_items: [{ variant_id: "v1", quantity: 1 }],
				}),
			}),
		);

		expect(res.status).toBe(201);
		const body = (await res.json()) as { checkout_session: { id: string } };
		expect(body.checkout_session.id).toBe("co_1");
		expect(mockSaleorQuery).toHaveBeenCalledTimes(3);
	});
});

describe("POST /api/ucp/rest/checkout-sessions/[id]/complete (integration)", () => {
	beforeEach(() => {
		mockSaleorQuery.mockReset();
		mockProcessStripePayment.mockReset();
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "warn").mockImplementation(() => {});
		_resetLimitBuckets();
		_resetEnvRegistryCache();
		devModeEnv();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		vi.unstubAllEnvs();
		_resetLimitBuckets();
		_resetEnvRegistryCache();
	});

	it("blocks completion with 429 when cart total exceeds spending cap (no Stripe call)", async () => {
		// SYNTHETIC_LEGACY_AGENT.per_session_cents = 10_000_00 cents (10000 USD).
		// Cart total = 11000 USD ⇒ 11_000_00¢, must trip the cap before payment.
		mockSaleorQuery.mockResolvedValueOnce({
			ok: true,
			data: { checkout: fakeCheckout(11000) },
		});

		const res = await completeCheckout(
			new Request("https://store.example/api/ucp/rest/checkout-sessions/co_1/complete", {
				method: "POST",
				headers: { Authorization: "Bearer dev-anything", "Content-Type": "application/json" },
				body: JSON.stringify({
					payment: { type: "com.stripe.shared_payment_token", token: "tok_x" },
				}),
			}),
			{ params: Promise.resolve({ id: "co_1" }) },
		);

		expect(res.status).toBe(429);
		expect(mockProcessStripePayment).not.toHaveBeenCalled();
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("rate_limited");
	});

	it("completes the checkout when under cap and payment succeeds", async () => {
		// Bound to the dev legacy-bearer agent so the ownership check passes.
		const cheap = {
			...fakeCheckout(50),
			metadata: [{ key: "ucp.agent_id", value: "legacy-bearer:anonymous" }],
		};

		// Order of saleorQuery calls inside the handler:
		//   1. computeAmountCents → CHECKOUT_BY_ID_QUERY
		//   2. handler verify-exists fetch → CHECKOUT_BY_ID_QUERY
		//   3. CHECKOUT_COMPLETE_MUTATION
		//   4. final fetch → CHECKOUT_BY_ID_QUERY
		mockSaleorQuery
			.mockResolvedValueOnce({ ok: true, data: { checkout: cheap } })
			.mockResolvedValueOnce({ ok: true, data: { checkout: cheap } })
			.mockResolvedValueOnce({
				ok: true,
				data: {
					checkoutComplete: {
						order: { id: "ord_1", number: "1001" },
						errors: [],
					},
				},
			})
			.mockResolvedValueOnce({ ok: true, data: { checkout: cheap } });

		mockProcessStripePayment.mockResolvedValueOnce({ ok: true });

		const res = await completeCheckout(
			new Request("https://store.example/api/ucp/rest/checkout-sessions/co_1/complete", {
				method: "POST",
				headers: { Authorization: "Bearer dev-anything" },
				body: JSON.stringify({
					payment: { type: "com.stripe.shared_payment_token", token: "tok_y" },
				}),
			}),
			{ params: Promise.resolve({ id: "co_1" }) },
		);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { order: { id: string } | null };
		expect(body.order?.id).toBe("ord_1");
		expect(mockProcessStripePayment).toHaveBeenCalledOnce();
	});
});
