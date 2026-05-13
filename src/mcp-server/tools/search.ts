import { registerAppTool } from "../apps/feature-flag";
import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { APP_RESOURCES } from "../apps/registry";
import { wrapAsData } from "../apps/sanitize";
import { saleorQuery, getDefaultChannel } from "../saleor-client";
import type { ProductCardPayload, ProductListPayload } from "@/mcp-apps/src/types";

const SEARCH_QUERY = `
	query MCPSearchProducts($search: String!, $first: Int!, $channel: String!) {
		products(
			first: $first
			channel: $channel
			filter: { search: $search }
		) {
			totalCount
			edges {
				node {
					id
					name
					slug
					isAvailable
					category { name slug }
					pricing {
						priceRange {
							start { gross { amount currency } }
							stop { gross { amount currency } }
						}
					}
					thumbnail(size: 512, format: WEBP) { url alt }
				}
			}
		}
	}
`;

export function registerSearchTools(server: McpServer) {
	registerAppTool(
		server,
		"search_products",
		{
			title: "Search products",
			description:
				"Search for products by text query. Returns product names, prices, availability, and URLs.",
			inputSchema: {
				query: z.string().describe("Search query text"),
				first: z.number().min(1).max(50).default(10).describe("Number of results (default 10, max 50)"),
				channel: z.string().default(getDefaultChannel()).describe("Sales channel slug"),
			},
			_meta: {
				ui: { resourceUri: APP_RESOURCES.productList.uri },
			},
		},
		async ({ query, first, channel }) => {
			const result = await saleorQuery(SEARCH_QUERY, {
				search: query,
				first,
				channel,
			});

			if (!result.ok) {
				return { content: [{ type: "text" as const, text: `Error: ${result.error}` }] };
			}

			const data = result.data as {
				products: {
					totalCount: number;
					edges: Array<{
						node: {
							id: string;
							name: string;
							slug: string;
							isAvailable: boolean;
							category: { name: string; slug: string } | null;
							pricing: {
								priceRange: {
									start: { gross: { amount: number; currency: string } };
									stop: { gross: { amount: number; currency: string } };
								};
							} | null;
							thumbnail: { url: string; alt: string | null } | null;
						};
					}>;
				};
			};

			const products: ProductCardPayload[] = data.products.edges.map((e) => {
				const min = e.node.pricing?.priceRange?.start?.gross?.amount ?? 0;
				const max = e.node.pricing?.priceRange?.stop?.gross?.amount ?? min;
				return {
					name: e.node.name,
					slug: e.node.slug,
					category: e.node.category?.name ?? null,
					inStock: e.node.isAvailable,
					price: {
						currency: e.node.pricing?.priceRange?.start?.gross?.currency ?? "",
						min,
						max: max === min ? null : max,
					},
					thumbnail: e.node.thumbnail?.url ?? null,
				};
			});

			const payload: ProductListPayload = {
				totalCount: data.products.totalCount,
				products,
			};

			return {
				content: [
					{
						type: "text" as const,
						text: wrapAsData(JSON.stringify(payload, null, 2), "product-list"),
					},
				],
			};
		},
	);
}
