import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { saleorQuery, getDefaultChannel } from "../saleor-client.js";

const PRODUCT_DETAIL_QUERY = `
	query MCPProductDetail($slug: String!, $channel: String!) {
		product(slug: $slug, channel: $channel) {
			id
			name
			slug
			description
			seoTitle
			seoDescription
			isAvailable
			category { name slug }
			productType { name }
			pricing {
				priceRange {
					start { gross { amount currency } }
					stop { gross { amount currency } }
				}
			}
			media { url alt type }
			variants {
				id
				name
				sku
				quantityAvailable
				pricing { price { gross { amount currency } } }
				attributes {
					attribute { slug name }
					values { name slug }
				}
				media { url alt }
			}
			attributes {
				attribute { slug name }
				values { name slug }
			}
		}
	}
`;

interface ProductDetailData {
	product: {
		id: string;
		name: string;
		slug: string;
		description: string | null;
		seoTitle: string | null;
		seoDescription: string | null;
		isAvailable: boolean;
		category: { name: string; slug: string } | null;
		productType: { name: string };
		pricing: {
			priceRange: {
				start: { gross: { amount: number; currency: string } };
				stop: { gross: { amount: number; currency: string } };
			};
		} | null;
		media: Array<{ url: string; alt: string | null; type: string }>;
		variants: Array<{
			id: string;
			name: string;
			sku: string | null;
			quantityAvailable: number | null;
			pricing: { price: { gross: { amount: number; currency: string } } } | null;
			attributes: Array<{
				attribute: { slug: string; name: string };
				values: Array<{ name: string; slug: string }>;
			}>;
			media: Array<{ url: string; alt: string | null }>;
		}>;
		attributes: Array<{
			attribute: { slug: string; name: string };
			values: Array<{ name: string; slug: string }>;
		}>;
	} | null;
}

function formatProduct(product: NonNullable<ProductDetailData["product"]>) {
	return {
		name: product.name,
		slug: product.slug,
		description: product.description,
		category: product.category?.name ?? null,
		productType: product.productType.name,
		inStock: product.isAvailable,
		price: {
			currency: product.pricing?.priceRange?.start?.gross?.currency ?? null,
			min: product.pricing?.priceRange?.start?.gross?.amount ?? null,
			max: product.pricing?.priceRange?.stop?.gross?.amount ?? null,
		},
		images: product.media.filter((m) => m.type === "IMAGE").map((m) => ({ url: m.url, alt: m.alt })),
		variants: product.variants.map((v) => ({
			id: v.id,
			name: v.name,
			sku: v.sku,
			inStock: (v.quantityAvailable ?? 0) > 0,
			quantityAvailable: v.quantityAvailable,
			price: v.pricing?.price?.gross?.amount ?? null,
			currency: v.pricing?.price?.gross?.currency ?? null,
			attributes: v.attributes.reduce(
				(acc, a) => {
					acc[a.attribute.slug] = a.values.map((val) => val.name).join(", ");
					return acc;
				},
				{} as Record<string, string>,
			),
		})),
		attributes: product.attributes.reduce(
			(acc, a) => {
				acc[a.attribute.slug] = a.values.map((val) => val.name);
				return acc;
			},
			{} as Record<string, string[]>,
		),
	};
}

export function registerProductTools(server: McpServer) {
	server.tool(
		"get_product_detail",
		"Get complete product details including all variants with prices, availability, attributes, and images.",
		{
			slug: z.string().describe("Product URL slug"),
			channel: z.string().default(getDefaultChannel()).describe("Sales channel slug"),
		},
		async ({ slug, channel }) => {
			const result = await saleorQuery<ProductDetailData>(PRODUCT_DETAIL_QUERY, { slug, channel });

			if (!result.ok) {
				return { content: [{ type: "text" as const, text: `Error: ${result.error}` }] };
			}

			if (!result.data.product) {
				return { content: [{ type: "text" as const, text: "Product not found" }] };
			}

			return {
				content: [
					{ type: "text" as const, text: JSON.stringify(formatProduct(result.data.product), null, 2) },
				],
			};
		},
	);

	server.tool(
		"compare_products",
		"Compare 2-5 products side by side. Returns a comparison table with prices, attributes, and availability.",
		{
			slugs: z
				.array(z.string())
				.min(2)
				.max(5)
				.describe("Product slugs to compare"),
			channel: z.string().default(getDefaultChannel()).describe("Sales channel slug"),
		},
		async ({ slugs, channel }) => {
			const results = await Promise.all(
				slugs.map((slug) => saleorQuery<ProductDetailData>(PRODUCT_DETAIL_QUERY, { slug, channel })),
			);

			const products = results
				.filter((r): r is { ok: true; data: ProductDetailData } => r.ok && r.data.product !== null)
				.map((r) => formatProduct(r.data.product!));

			if (products.length === 0) {
				return { content: [{ type: "text" as const, text: "No products found for the given slugs" }] };
			}

			return {
				content: [
					{ type: "text" as const, text: JSON.stringify({ comparison: products }, null, 2) },
				],
			};
		},
	);
}
