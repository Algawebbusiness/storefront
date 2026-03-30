/**
 * Maps Saleor product data to ACP product feed format.
 *
 * Reuses the same ProductNode shape from the existing feed.json endpoint.
 */

import type { AcpProduct, AcpVariant } from "./types";
import { toMinorUnits } from "../shared/money";

/** Saleor product node — same shape as used in feed.json/route.ts */
export interface SaleorProductNode {
	id: string;
	name: string;
	slug: string;
	isAvailable: boolean;
	updatedAt: string;
	description: string | null;
	category: { name: string; slug: string } | null;
	pricing: {
		priceRange: {
			start: { gross: { amount: number; currency: string } };
			stop: { gross: { amount: number; currency: string } };
		};
	} | null;
	thumbnail: { url: string; alt: string | null } | null;
	media: Array<{ url: string; alt: string | null; type: string }>;
	variants: Array<{
		id: string;
		name: string;
		sku: string | null;
		quantityAvailable: number | null;
		pricing: { price: { gross: { amount: number; currency: string } } } | null;
		attributes: Array<{
			attribute: { slug: string; name: string };
			values: Array<{ name: string }>;
		}>;
	}>;
	attributes: Array<{
		attribute: { slug: string; name: string };
		values: Array<{ name: string }>;
	}>;
}

/** Strip EditorJS JSON or HTML to plain text */
function stripToPlainText(text: string | null): string | null {
	if (!text) return null;
	try {
		const parsed = JSON.parse(text) as { blocks?: Array<{ data?: { text?: string } }> };
		if (parsed.blocks) {
			return parsed.blocks
				.map((b) => b.data?.text ?? "")
				.filter(Boolean)
				.join(" ");
		}
	} catch {
		// Not EditorJS JSON
	}
	return text.replace(/<[^>]*>/g, "").trim() || null;
}

/** Extract attribute value by slug (e.g., "brand", "gtin") */
function getAttributeValue(
	attributes: SaleorProductNode["attributes"],
	slug: string,
): string | null {
	const attr = attributes.find((a) => a.attribute.slug === slug);
	return attr?.values[0]?.name ?? null;
}

/** Map a Saleor product to ACP feed format */
export function mapProductToAcp(
	node: SaleorProductNode,
	baseUrl: string,
	channel: string,
): AcpProduct {
	const startPrice = node.pricing?.priceRange?.start?.gross;
	const primaryImage = node.media.find((m) => m.type === "IMAGE");

	const variants: AcpVariant[] = node.variants.map((v) => ({
		id: v.id,
		name: v.name,
		sku: v.sku,
		price: v.pricing?.price?.gross
			? toMinorUnits(v.pricing.price.gross)
			: { amount: 0, currency: startPrice?.currency ?? "USD" },
		availability: (v.quantityAvailable ?? 0) > 0 ? "in_stock" : "out_of_stock",
		attributes: v.attributes.reduce(
			(acc, a) => {
				acc[a.attribute.slug] = a.values.map((val) => val.name).join(", ");
				return acc;
			},
			{} as Record<string, string>,
		),
	}));

	return {
		id: node.id,
		title: node.name,
		description: stripToPlainText(node.description),
		url: `${baseUrl}/${channel}/products/${node.slug}`,
		image_url: primaryImage?.url ?? node.thumbnail?.url ?? null,
		price: startPrice
			? toMinorUnits(startPrice)
			: { amount: 0, currency: "USD" },
		availability: node.isAvailable ? "in_stock" : "out_of_stock",
		sku: node.variants[0]?.sku ?? null,
		gtin: getAttributeValue(node.attributes, "gtin") ?? getAttributeValue(node.attributes, "ean"),
		mpn: getAttributeValue(node.attributes, "mpn"),
		brand: getAttributeValue(node.attributes, "brand"),
		category: node.category?.name ?? null,
		variants,
		updated_at: node.updatedAt,
	};
}
