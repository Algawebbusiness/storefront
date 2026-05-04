import { describe, expect, it } from "vitest";
import { mapCheckoutToCart } from "@/lib/protocols/shared/cart-mapper";
import type { SaleorCheckout } from "@/lib/protocols/shared/checkout-queries";

function makeCheckout(overrides: Partial<SaleorCheckout> = {}): SaleorCheckout {
	const base: SaleorCheckout = {
		id: "ck_test_1",
		email: null,
		channel: { id: "Q2hhbm5lbDox", slug: "default-channel" },
		lines: [],
		totalPrice: {
			gross: { amount: 0, currency: "CZK" },
			tax: { amount: 0, currency: "CZK" },
		},
		subtotalPrice: { gross: { amount: 0, currency: "CZK" } },
		shippingPrice: { gross: { amount: 0, currency: "CZK" } },
		discount: null,
		shippingAddress: null,
		billingAddress: null,
		deliveryMethod: null,
		shippingMethods: [],
		isShippingRequired: true,
		authorizeStatus: "NONE",
		chargeStatus: "NONE",
	};
	return { ...base, ...overrides };
}

describe("mapCheckoutToCart — basic shape", () => {
	it("emits a top-level mandatory currency even for an empty cart", () => {
		const cart = mapCheckoutToCart(
			makeCheckout({
				totalPrice: {
					gross: { amount: 0, currency: "EUR" },
					tax: { amount: 0, currency: "EUR" },
				},
			}),
		);
		expect(cart.currency).toBe("EUR");
		expect(cart.lines).toEqual([]);
	});

	it("defaults status to active and respects override to cancelled", () => {
		const cart = mapCheckoutToCart(makeCheckout());
		expect(cart.status).toBe("active");

		const cancelled = mapCheckoutToCart(makeCheckout(), { status: "cancelled" });
		expect(cancelled.status).toBe("cancelled");
	});

	it("zeroes the discount entry when the checkout has no discount", () => {
		const cart = mapCheckoutToCart(makeCheckout());
		expect(cart.totals.discount).toEqual({ amount: 0, currency: "CZK" });
		expect(cart.applied_discounts).toBeUndefined();
	});
});

describe("mapCheckoutToCart — lines and totals", () => {
	const checkout = makeCheckout({
		lines: [
			{
				id: "line_1",
				quantity: 2,
				totalPrice: { gross: { amount: 240.5, currency: "CZK" } },
				unitPrice: { gross: { amount: 120.25, currency: "CZK" } },
				variant: {
					id: "var_1",
					name: "Default",
					sku: "BEAN-ETHIO-250",
					product: {
						id: "prod_1",
						name: "Ethiopian Beans",
						slug: "ethiopian-beans",
						thumbnail: { url: "https://cdn/img.webp" },
						media: [{ url: "https://cdn/img.webp", type: "IMAGE" }],
					},
				},
			},
		],
		subtotalPrice: { gross: { amount: 240.5, currency: "CZK" } },
		shippingPrice: { gross: { amount: 99, currency: "CZK" } },
		totalPrice: {
			gross: { amount: 339.5, currency: "CZK" },
			tax: { amount: 58.95, currency: "CZK" },
		},
	});

	it("maps each Saleor line to a UCP cart line with sku, ids, and minor-unit prices", () => {
		const cart = mapCheckoutToCart(checkout);
		expect(cart.lines).toHaveLength(1);
		const [line] = cart.lines;
		expect(line!.id).toBe("line_1");
		expect(line!.sku).toBe("BEAN-ETHIO-250");
		expect(line!.product_id).toBe("prod_1");
		expect(line!.variant_id).toBe("var_1");
		expect(line!.name).toBe("Ethiopian Beans - Default");
		expect(line!.quantity).toBe(2);
		expect(line!.unit_price).toEqual({ amount: 12025, currency: "CZK" });
		expect(line!.total_price).toEqual({ amount: 24050, currency: "CZK" });
		expect(line!.image_url).toBe("https://cdn/img.webp");
	});

	it("converts totals to minor units (CZK = 2 decimals)", () => {
		const cart = mapCheckoutToCart(checkout);
		expect(cart.totals.subtotal).toEqual({ amount: 24050, currency: "CZK" });
		expect(cart.totals.shipping).toEqual({ amount: 9900, currency: "CZK" });
		expect(cart.totals.tax).toEqual({ amount: 5895, currency: "CZK" });
		expect(cart.totals.total).toEqual({ amount: 33950, currency: "CZK" });
	});
});

describe("mapCheckoutToCart — discounts", () => {
	it("surfaces non-zero discount through both totals.discount and applied_discounts", () => {
		const cart = mapCheckoutToCart(
			makeCheckout({
				discount: { amount: 50, currency: "CZK" },
			}),
		);
		expect(cart.totals.discount).toEqual({ amount: 5000, currency: "CZK" });
		expect(cart.applied_discounts).toEqual([{ amount: { amount: 5000, currency: "CZK" } }]);
	});

	it("does not emit applied_discounts when the discount amount is zero", () => {
		const cart = mapCheckoutToCart(
			makeCheckout({
				discount: { amount: 0, currency: "CZK" },
			}),
		);
		expect(cart.totals.discount).toEqual({ amount: 0, currency: "CZK" });
		expect(cart.applied_discounts).toBeUndefined();
	});
});

describe("mapCheckoutToCart — sku nullable", () => {
	it("preserves null sku when Saleor variant has none (digital products, etc.)", () => {
		const cart = mapCheckoutToCart(
			makeCheckout({
				lines: [
					{
						id: "line_2",
						quantity: 1,
						totalPrice: { gross: { amount: 1, currency: "CZK" } },
						unitPrice: { gross: { amount: 1, currency: "CZK" } },
						variant: {
							id: "var_2",
							name: "v",
							sku: null,
							product: {
								id: "p2",
								name: "P",
								slug: "p",
								thumbnail: null,
								media: [],
							},
						},
					},
				],
				subtotalPrice: { gross: { amount: 1, currency: "CZK" } },
				totalPrice: {
					gross: { amount: 1, currency: "CZK" },
					tax: { amount: 0, currency: "CZK" },
				},
			}),
		);
		expect(cart.lines[0]!.sku).toBeNull();
		expect(cart.lines[0]!.image_url).toBeUndefined();
	});
});
