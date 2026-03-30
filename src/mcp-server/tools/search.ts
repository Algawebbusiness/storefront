import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { saleorQuery, getDefaultChannel } from "../saleor-client.js";

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
					variants {
						id
						name
						quantityAvailable
					}
				}
			}
		}
	}
`;

export function registerSearchTools(server: McpServer) {
	server.tool(
		"search_products",
		"Search for products by text query. Returns product names, prices, availability, and URLs.",
		{
			query: z.string().describe("Search query text"),
			first: z.number().min(1).max(50).default(10).describe("Number of results (default 10, max 50)"),
			channel: z.string().default(getDefaultChannel()).describe("Sales channel slug"),
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
							variants: Array<{ id: string; name: string; quantityAvailable: number | null }>;
						};
					}>;
				};
			};

			const products = data.products.edges.map((e) => ({
				name: e.node.name,
				slug: e.node.slug,
				category: e.node.category?.name ?? null,
				inStock: e.node.isAvailable,
				price: {
					currency: e.node.pricing?.priceRange?.start?.gross?.currency ?? null,
					min: e.node.pricing?.priceRange?.start?.gross?.amount ?? null,
					max: e.node.pricing?.priceRange?.stop?.gross?.amount ?? null,
				},
				thumbnail: e.node.thumbnail?.url ?? null,
				variantCount: e.node.variants.length,
			}));

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{ totalCount: data.products.totalCount, products },
							null,
							2,
						),
					},
				],
			};
		},
	);
}
