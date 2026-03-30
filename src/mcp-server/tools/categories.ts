import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { saleorQuery, getDefaultChannel } from "../saleor-client.js";

const ALL_CATEGORIES_QUERY = `
	query MCPAllCategories($first: Int!, $channel: String!) {
		categories(first: $first) {
			edges {
				node {
					id
					name
					slug
					description
					parent { id name slug }
					products(channel: $channel, first: 0) { totalCount }
				}
			}
		}
	}
`;

const CATEGORY_PRODUCTS_QUERY = `
	query MCPCategoryProducts($slug: String!, $channel: String!, $first: Int!) {
		category(slug: $slug) {
			id
			name
			slug
			description
			products(channel: $channel, first: $first) {
				totalCount
				edges {
					node {
						id
						name
						slug
						isAvailable
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
							pricing { price { gross { amount currency } } }
							attributes {
								attribute { slug name }
								values { name }
							}
						}
					}
				}
			}
		}
	}
`;

export function registerCategoryTools(server: McpServer) {
	server.tool(
		"list_categories",
		"List all product categories with product counts and hierarchy.",
		{
			channel: z.string().default(getDefaultChannel()).describe("Sales channel slug"),
		},
		async ({ channel }) => {
			const result = await saleorQuery(ALL_CATEGORIES_QUERY, { first: 100, channel });

			if (!result.ok) {
				return { content: [{ type: "text" as const, text: `Error: ${result.error}` }] };
			}

			const data = result.data as {
				categories: {
					edges: Array<{
						node: {
							id: string;
							name: string;
							slug: string;
							description: string | null;
							parent: { id: string; name: string; slug: string } | null;
							products: { totalCount: number };
						};
					}>;
				};
			};

			const categories = data.categories.edges.map((e) => ({
				name: e.node.name,
				slug: e.node.slug,
				parentSlug: e.node.parent?.slug ?? null,
				productCount: e.node.products.totalCount,
			}));

			return {
				content: [{ type: "text" as const, text: JSON.stringify(categories, null, 2) }],
			};
		},
	);

	server.tool(
		"get_category_products",
		"Get products in a specific category.",
		{
			categorySlug: z.string().describe("Category URL slug"),
			first: z.number().min(1).max(50).default(10).describe("Number of results"),
			channel: z.string().default(getDefaultChannel()).describe("Sales channel slug"),
		},
		async ({ categorySlug, first, channel }) => {
			const result = await saleorQuery(CATEGORY_PRODUCTS_QUERY, {
				slug: categorySlug,
				channel,
				first,
			});

			if (!result.ok) {
				return { content: [{ type: "text" as const, text: `Error: ${result.error}` }] };
			}

			const data = result.data as {
				category: {
					name: string;
					slug: string;
					description: string | null;
					products: {
						totalCount: number;
						edges: Array<{
							node: {
								name: string;
								slug: string;
								isAvailable: boolean;
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
				} | null;
			};

			if (!data.category) {
				return { content: [{ type: "text" as const, text: "Category not found" }] };
			}

			const products = data.category.products.edges.map((e) => ({
				name: e.node.name,
				slug: e.node.slug,
				inStock: e.node.isAvailable,
				price: {
					currency: e.node.pricing?.priceRange?.start?.gross?.currency ?? null,
					min: e.node.pricing?.priceRange?.start?.gross?.amount ?? null,
					max: e.node.pricing?.priceRange?.stop?.gross?.amount ?? null,
				},
				thumbnail: e.node.thumbnail?.url ?? null,
			}));

			return {
				content: [
					{
						type: "text" as const,
						text: JSON.stringify(
							{
								category: data.category.name,
								totalCount: data.category.products.totalCount,
								products,
							},
							null,
							2,
						),
					},
				],
			};
		},
	);
}
