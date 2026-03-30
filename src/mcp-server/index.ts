import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTools } from "./tools/search.js";
import { registerCategoryTools } from "./tools/categories.js";
import { registerProductTools } from "./tools/products.js";
import { registerCollectionTools } from "./tools/collections.js";
import { registerStoreInfoTools } from "./tools/store-info.js";

/**
 * Public read-only MCP server for the Saleor storefront.
 *
 * Exposes 7 tools for AI agents to browse and search products
 * without parsing HTML. No authentication required.
 *
 * Tools:
 * - search_products — text search across products
 * - list_categories — category tree with product counts
 * - get_category_products — products in a specific category
 * - get_product_detail — full product details with variants
 * - compare_products — side-by-side product comparison
 * - get_collections — list all collections
 * - get_store_info — store name, contact, policies
 */
export function createMcpServer(): McpServer {
	const server = new McpServer({
		name: "saleor-storefront",
		version: "1.0.0",
	});

	registerSearchTools(server);
	registerCategoryTools(server);
	registerProductTools(server);
	registerCollectionTools(server);
	registerStoreInfoTools(server);

	return server;
}
