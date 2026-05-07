/**
 * Maps Saleor `Product` to the UCP catalog item shape (Phase A5).
 *
 * UCP catalog items are designed for agent consumption: structured `attributes`
 * (slug → human value), top-level `availability` enum, and `price` in minor
 * units. The shape uses `amount_cents` (not the cart layer's `amount`) per the
 * UCP 2026-04-08 catalog schema.
 *
 * Variants are emitted as a separate `UcpCatalogVariant` type rather than
 * recursive `UcpCatalogItem[]` — variants don't carry a slug or product-level
 * description, so a recursive type would lie.
 */

import { toMinorUnits } from "./money";
import type { SaleorCatalogProduct, SaleorCatalogVariant, SaleorCategoryNode } from "./catalog-queries";

const STOREFRONT_URL = process.env.NEXT_PUBLIC_STOREFRONT_URL || "http://localhost:3000";

export type UcpAvailability = "in_stock" | "out_of_stock" | "preorder";

export interface UcpCatalogPrice {
	amount_cents: number;
	currency: string;
}

export interface UcpCatalogImage {
	url: string;
	alt?: string;
}

export interface UcpCatalogVariant {
	id: string;
	sku: string;
	name: string;
	price: UcpCatalogPrice | null;
	availability: UcpAvailability;
	attributes: Record<string, string>;
}

export interface UcpCatalogItem {
	id: string;
	sku: string;
	title: string;
	description: string;
	url: string;
	images: UcpCatalogImage[];
	price: UcpCatalogPrice | null;
	availability: UcpAvailability;
	category?: string;
	attributes: Record<string, string>;
	variants?: UcpCatalogVariant[];
}

export interface UcpCatalogCategory {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	product_count: number;
	children: Array<{ id: string; slug: string; name: string }>;
}

/**
 * Map a Saleor product to a UCP catalog item.
 *
 * @param product   Saleor product as fetched via CATALOG_PRODUCT_FRAGMENT
 * @param channel   Saleor channel slug, used for the canonical product URL
 * @param options.includeVariants  Emit `variants[]` (default: true). Search
 *                                 results may want this off for payload size.
 */
export function mapProductToCatalogItem(
	product: SaleorCatalogProduct,
	channel: string,
	options: { includeVariants?: boolean } = {},
): UcpCatalogItem {
	const includeVariants = options.includeVariants ?? true;

	const item: UcpCatalogItem = {
		id: product.id,
		sku: product.defaultVariant?.sku ?? product.variants[0]?.sku ?? "",
		title: product.name,
		description: product.description ?? "",
		url: `${STOREFRONT_URL}/${channel}/products/${product.slug}`,
		images: product.media
			.filter((m) => m.type === "IMAGE")
			.map((m) => ({ url: m.url, ...(m.alt ? { alt: m.alt } : {}) })),
		price: priceFromRange(product),
		availability: deriveProductAvailability(product),
		attributes: mapAttributes(product.attributes),
	};

	if (product.category) {
		item.category = product.category.slug;
	}

	if (includeVariants) {
		item.variants = product.variants.map((v) => mapVariant(v));
	}

	return item;
}

function mapVariant(variant: SaleorCatalogVariant): UcpCatalogVariant {
	return {
		id: variant.id,
		sku: variant.sku ?? "",
		name: variant.name,
		price: variant.pricing?.price.gross
			? toCatalogPrice(variant.pricing.price.gross.amount, variant.pricing.price.gross.currency)
			: null,
		availability: deriveVariantAvailability(variant),
		attributes: mapAttributes(variant.attributes),
	};
}

function priceFromRange(product: SaleorCatalogProduct): UcpCatalogPrice | null {
	const start = product.pricing?.priceRange.start.gross;
	if (!start) return null;
	return toCatalogPrice(start.amount, start.currency);
}

function toCatalogPrice(amount: number, currency: string): UcpCatalogPrice {
	const minor = toMinorUnits({ amount, currency });
	return { amount_cents: minor.amount, currency: minor.currency };
}

function deriveProductAvailability(product: SaleorCatalogProduct): UcpAvailability {
	if (product.variants.some((v) => isPreorder(v))) {
		return "preorder";
	}
	const hasStock = product.variants.some((v) => (v.quantityAvailable ?? 0) > 0);
	if (product.isAvailable && product.isAvailableForPurchase && hasStock) {
		return "in_stock";
	}
	return "out_of_stock";
}

function deriveVariantAvailability(variant: SaleorCatalogVariant): UcpAvailability {
	if (isPreorder(variant)) return "preorder";
	if ((variant.quantityAvailable ?? 0) > 0) return "in_stock";
	return "out_of_stock";
}

function isPreorder(variant: SaleorCatalogVariant): boolean {
	return variant.preorder !== null && variant.preorder !== undefined;
}

function mapAttributes(
	attrs: Array<{
		attribute: { slug: string; name: string };
		values: Array<{ name: string; slug: string }>;
	}>,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const a of attrs) {
		if (a.values.length === 0) continue;
		out[a.attribute.slug] = a.values.map((v) => v.name).join(", ");
	}
	return out;
}

/** Map a Saleor category node to the UCP catalog category shape. */
export function mapCategoryToCatalogCategory(node: SaleorCategoryNode): UcpCatalogCategory {
	return {
		id: node.id,
		slug: node.slug,
		name: node.name,
		description: node.description,
		product_count: node.products.totalCount,
		children: node.children.edges.map((e) => ({
			id: e.node.id,
			slug: e.node.slug,
			name: e.node.name,
		})),
	};
}
