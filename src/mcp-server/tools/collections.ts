import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { saleorQuery, getDefaultChannel } from "../saleor-client.js";

const ALL_COLLECTIONS_QUERY = `
	query MCPAllCollections($channel: String!, $first: Int!) {
		collections(channel: $channel, first: $first) {
			edges {
				node {
					id
					name
					slug
					description
					products(first: 0) { totalCount }
				}
			}
		}
	}
`;

export function registerCollectionTools(server: McpServer) {
	server.tool(
		"get_collections",
		"Get product collections (seasonal offers, sales, featured).",
		{
			channel: z.string().default(getDefaultChannel()).describe("Sales channel slug"),
		},
		async ({ channel }) => {
			const result = await saleorQuery(ALL_COLLECTIONS_QUERY, { channel, first: 100 });

			if (!result.ok) {
				return { content: [{ type: "text" as const, text: `Error: ${result.error}` }] };
			}

			const data = result.data as {
				collections: {
					edges: Array<{
						node: {
							name: string;
							slug: string;
							description: string | null;
							products: { totalCount: number };
						};
					}>;
				};
			};

			const collections = data.collections.edges.map((e) => ({
				name: e.node.name,
				slug: e.node.slug,
				description: e.node.description,
				productCount: e.node.products.totalCount,
			}));

			return {
				content: [{ type: "text" as const, text: JSON.stringify(collections, null, 2) }],
			};
		},
	);
}
