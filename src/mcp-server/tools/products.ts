import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_RESOURCES } from "../apps/registry";
import { sanitizeForLlm, wrapAsData } from "../apps/sanitize";
import { saleorQuery, getDefaultChannel } from "../saleor-client";
import { parseEditorJSToText } from "@/lib/editorjs";
import type { ProductDetailPayload, ProductFull } from "@/mcp-apps/src/types";

const PRODUCT_DETAIL_QUERY = `
	query MCPProductDetail($slug: String!, $channel: String!) {
		product(slug: $slug, channel: $channel) {
			id
			name
			slug
			description
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
		}>;
		attributes: Array<{
			attribute: { slug: string; name: string };
			values: Array<{ name: string; slug: string }>;
		}>;
	} | null;
}

/**
 * Map a Saleor product to the iframe-bound `ProductFull` shape.
 *
 * Two non-trivial transforms:
 *   - `description` is Saleor's EditorJS-encoded rich text. We parse it
 *     to plain text via `parseEditorJSToText`, then strip prompt-injection
 *     vectors via `sanitizeForLlm` before it reaches the LLM-visible
 *     content block (threat-model §3 mitigation matrix).
 *   - `price.max` is `null` when the product has a single price point
 *     (matches the F4 `ProductCardPayload` convention so cards inside
 *     the detail compare-row render the same way as cards in lists).
 */
function formatProduct(product: NonNullable<ProductDetailData["product"]>): ProductFull {
	const plain = parseEditorJSToText(product.description);
	const description = plain ? sanitizeForLlm(plain) : null;

	const min = product.pricing?.priceRange?.start?.gross?.amount ?? 0;
	const max = product.pricing?.priceRange?.stop?.gross?.amount ?? min;
	const currency = product.pricing?.priceRange?.start?.gross?.currency ?? "";

	return {
		name: product.name,
		slug: product.slug,
		description,
		category: product.category?.name ?? null,
		productType: product.productType.name,
		inStock: product.isAvailable,
		price: { min, max: max === min ? null : max, currency },
		images: product.media.filter((m) => m.type === "IMAGE").map((m) => ({ url: m.url, alt: m.alt })),
		variants: product.variants.map((v) => ({
			id: v.id,
			name: v.name,
			sku: v.sku,
			inStock: (v.quantityAvailable ?? 0) > 0,
			quantityAvailable: v.quantityAvailable,
			price: v.pricing?.price?.gross?.amount ?? null,
			currency: v.pricing?.price?.gross?.currency ?? null,
			attributes: v.attributes.reduce<Record<string, string>>((acc, a) => {
				acc[a.attribute.slug] = a.values.map((val) => val.name).join(", ");
				return acc;
			}, {}),
		})),
		attributes: product.attributes.reduce<Record<string, string[]>>((acc, a) => {
			acc[a.attribute.slug] = a.values.map((val) => val.name);
			return acc;
		}, {}),
	};
}

export function registerProductTools(server: McpServer) {
	registerAppTool(
		server,
		"get_product_detail",
		{
			title: "Get product detail",
			description:
				"Get complete product details including all variants with prices, availability, attributes, and images.",
			inputSchema: {
				slug: z.string().describe("Product URL slug"),
				channel: z.string().default(getDefaultChannel()).describe("Sales channel slug"),
			},
			_meta: {
				ui: { resourceUri: APP_RESOURCES.productDetail.uri },
			},
		},
		async ({ slug, channel }) => {
			const result = await saleorQuery<ProductDetailData>(PRODUCT_DETAIL_QUERY, { slug, channel });

			if (!result.ok) {
				return { content: [{ type: "text" as const, text: `Error: ${result.error}` }] };
			}

			if (!result.data.product) {
				return { content: [{ type: "text" as const, text: "Product not found" }] };
			}

			const payload: ProductDetailPayload = {
				mode: "single",
				product: formatProduct(result.data.product),
			};

			return {
				content: [
					{
						type: "text" as const,
						text: wrapAsData(JSON.stringify(payload, null, 2), "product-detail"),
					},
				],
			};
		},
	);

	registerAppTool(
		server,
		"compare_products",
		{
			title: "Compare products",
			description:
				"Compare 2-5 products side by side. Returns a comparison table with prices, attributes, and availability.",
			inputSchema: {
				slugs: z.array(z.string()).min(2).max(5).describe("Product slugs to compare"),
				channel: z.string().default(getDefaultChannel()).describe("Sales channel slug"),
			},
			_meta: {
				ui: { resourceUri: APP_RESOURCES.productDetail.uri },
			},
		},
		async ({ slugs, channel }) => {
			const results = await Promise.all(
				slugs.map((slug) => saleorQuery<ProductDetailData>(PRODUCT_DETAIL_QUERY, { slug, channel })),
			);

			const products = results
				.filter((r): r is { ok: true; data: ProductDetailData } => r.ok && r.data.product !== null)
				.map((r) => formatProduct(r.data.product!));

			if (products.length === 0) {
				return {
					content: [{ type: "text" as const, text: "No products found for the given slugs" }],
				};
			}

			const payload: ProductDetailPayload = { mode: "compare", products };

			return {
				content: [
					{
						type: "text" as const,
						text: wrapAsData(JSON.stringify(payload, null, 2), "product-detail"),
					},
				],
			};
		},
	);
}
