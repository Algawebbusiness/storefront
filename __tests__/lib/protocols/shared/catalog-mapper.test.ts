import { describe, expect, it } from "vitest";
import { mapCategoryToCatalogCategory, mapProductToCatalogItem } from "@/lib/protocols/shared/catalog-mapper";
import type {
	SaleorCatalogProduct,
	SaleorCatalogVariant,
	SaleorCategoryNode,
} from "@/lib/protocols/shared/catalog-queries";

function makeVariant(overrides: Partial<SaleorCatalogVariant> = {}): SaleorCatalogVariant {
	return {
		id: "var_default",
		name: "Default",
		sku: "SKU-1",
		quantityAvailable: 5,
		pricing: { price: { gross: { amount: 199, currency: "CZK" } } },
		attributes: [],
		preorder: null,
		...overrides,
	};
}

function makeProduct(overrides: Partial<SaleorCatalogProduct> = {}): SaleorCatalogProduct {
	const variant = makeVariant();
	return {
		id: "prod_1",
		name: "Ethiopian Beans",
		slug: "ethiopian-beans",
		description: "Floral, citrus.",
		isAvailable: true,
		isAvailableForPurchase: true,
		category: { id: "cat_1", name: "Coffee", slug: "coffee" },
		pricing: {
			priceRange: {
				start: { gross: { amount: 199, currency: "CZK" } },
				stop: { gross: { amount: 250, currency: "CZK" } },
			},
		},
		media: [
			{ url: "https://cdn/a.webp", alt: "front", type: "IMAGE" },
			{ url: "https://cdn/v.mp4", alt: null, type: "VIDEO" },
		],
		defaultVariant: { id: variant.id, sku: variant.sku },
		variants: [variant],
		attributes: [
			{
				attribute: { slug: "origin", name: "Origin" },
				values: [{ name: "Ethiopia", slug: "ethiopia" }],
			},
			{
				attribute: { slug: "process", name: "Process" },
				values: [
					{ name: "Natural", slug: "natural" },
					{ name: "Anaerobic", slug: "anaerobic" },
				],
			},
		],
		...overrides,
	};
}

describe("mapProductToCatalogItem — basic shape", () => {
	it("maps top-level fields and price (minor units)", () => {
		const item = mapProductToCatalogItem(makeProduct(), "default-channel");
		expect(item.id).toBe("prod_1");
		expect(item.title).toBe("Ethiopian Beans");
		expect(item.description).toBe("Floral, citrus.");
		expect(item.url).toMatch(/\/default-channel\/products\/ethiopian-beans$/);
		expect(item.sku).toBe("SKU-1");
		expect(item.price).toEqual({ amount_cents: 19900, currency: "CZK" });
		expect(item.category).toBe("coffee");
	});

	it("filters images down to IMAGE-typed media and preserves alt", () => {
		const item = mapProductToCatalogItem(makeProduct(), "default-channel");
		expect(item.images).toEqual([{ url: "https://cdn/a.webp", alt: "front" }]);
	});

	it("emits structured attributes (slug → joined value names) per UCP catalog spec", () => {
		const item = mapProductToCatalogItem(makeProduct(), "default-channel");
		expect(item.attributes).toEqual({
			origin: "Ethiopia",
			process: "Natural, Anaerobic",
		});
	});

	it("falls back from defaultVariant.sku to the first variant's sku, then empty string", () => {
		const noDefault = mapProductToCatalogItem(makeProduct({ defaultVariant: null }), "default-channel");
		expect(noDefault.sku).toBe("SKU-1");

		const noSku = mapProductToCatalogItem(
			makeProduct({
				defaultVariant: null,
				variants: [makeVariant({ sku: null })],
			}),
			"default-channel",
		);
		expect(noSku.sku).toBe("");
	});
});

describe("mapProductToCatalogItem — availability", () => {
	it("returns 'in_stock' when product is available and variants have stock", () => {
		const item = mapProductToCatalogItem(makeProduct(), "c");
		expect(item.availability).toBe("in_stock");
	});

	it("returns 'out_of_stock' when no variant has positive stock", () => {
		const item = mapProductToCatalogItem(
			makeProduct({ variants: [makeVariant({ quantityAvailable: 0 })] }),
			"c",
		);
		expect(item.availability).toBe("out_of_stock");
	});

	it("returns 'out_of_stock' when isAvailableForPurchase is false even with stock", () => {
		const item = mapProductToCatalogItem(makeProduct({ isAvailableForPurchase: false }), "c");
		expect(item.availability).toBe("out_of_stock");
	});

	it("returns 'preorder' when any variant has a preorder flag", () => {
		const item = mapProductToCatalogItem(
			makeProduct({
				variants: [makeVariant({ quantityAvailable: 0, preorder: { endDate: "2026-12-31" } })],
			}),
			"c",
		);
		expect(item.availability).toBe("preorder");
	});
});

describe("mapProductToCatalogItem — variants toggle", () => {
	it("omits variants[] when includeVariants=false (search result payload)", () => {
		const item = mapProductToCatalogItem(makeProduct(), "c", { includeVariants: false });
		expect(item.variants).toBeUndefined();
	});

	it("emits variants[] with their own price/availability/attributes by default", () => {
		const item = mapProductToCatalogItem(
			makeProduct({
				variants: [
					makeVariant({
						id: "var_a",
						name: "250g",
						sku: "SKU-A",
						quantityAvailable: 3,
						attributes: [
							{
								attribute: { slug: "weight", name: "Weight" },
								values: [{ name: "250g", slug: "250g" }],
							},
						],
					}),
					makeVariant({
						id: "var_b",
						name: "1kg",
						sku: null,
						quantityAvailable: 0,
						pricing: null,
					}),
				],
			}),
			"c",
		);
		expect(item.variants).toHaveLength(2);
		expect(item.variants![0]).toEqual({
			id: "var_a",
			sku: "SKU-A",
			name: "250g",
			price: { amount_cents: 19900, currency: "CZK" },
			availability: "in_stock",
			attributes: { weight: "250g" },
		});
		expect(item.variants![1]).toEqual({
			id: "var_b",
			sku: "",
			name: "1kg",
			price: null,
			availability: "out_of_stock",
			attributes: {},
		});
	});
});

describe("mapProductToCatalogItem — edge cases", () => {
	it("returns price=null when Saleor pricing is missing", () => {
		const item = mapProductToCatalogItem(makeProduct({ pricing: null }), "c");
		expect(item.price).toBeNull();
	});

	it("omits category when product has no category", () => {
		const item = mapProductToCatalogItem(makeProduct({ category: null }), "c");
		expect(item.category).toBeUndefined();
	});

	it("treats null description as empty string", () => {
		const item = mapProductToCatalogItem(makeProduct({ description: null }), "c");
		expect(item.description).toBe("");
	});
});

describe("mapCategoryToCatalogCategory", () => {
	it("maps node, children edges, and product count", () => {
		const node: SaleorCategoryNode = {
			id: "cat_top",
			name: "Coffee",
			slug: "coffee",
			description: "All coffee products",
			children: {
				edges: [
					{ node: { id: "cat_eth", name: "Ethiopia", slug: "ethiopia" } },
					{ node: { id: "cat_col", name: "Colombia", slug: "colombia" } },
				],
			},
			products: { totalCount: 42 },
		};
		expect(mapCategoryToCatalogCategory(node)).toEqual({
			id: "cat_top",
			slug: "coffee",
			name: "Coffee",
			description: "All coffee products",
			product_count: 42,
			children: [
				{ id: "cat_eth", slug: "ethiopia", name: "Ethiopia" },
				{ id: "cat_col", slug: "colombia", name: "Colombia" },
			],
		});
	});
});
