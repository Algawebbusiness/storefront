import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllAppResources } from "./apps";
import { registerSearchTools } from "./tools/search";
import { registerCategoryTools } from "./tools/categories";
import { registerProductTools } from "./tools/products";
import { registerCollectionTools } from "./tools/collections";
import { registerStoreInfoTools } from "./tools/store-info";
import { registerCheckoutTools } from "./tools/checkout";
import { registerCartPreviewTools } from "./tools/cart-preview";

/**
 * MCP server for the Saleor storefront.
 *
 * Exposes 12 tools for AI agents: 7 public read-only tools for
 * browsing/searching, and 5 authenticated checkout tools for purchasing.
 *
 * Read-only tools (no auth):
 * - search_products — text search across products
 * - list_categories — category tree with product counts
 * - get_category_products — products in a specific category
 * - get_product_detail — full product details with variants
 * - compare_products — side-by-side product comparison
 * - get_collections — list all collections
 * - get_store_info — store name, contact, policies
 *
 * Checkout tools (require api_key parameter):
 * - create_checkout — create checkout with line items
 * - get_checkout — get checkout state
 * - update_checkout — update email, addresses, shipping, promo
 * - complete_checkout — process payment and finalize order
 * - cancel_checkout — cancel a checkout session
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
	registerCheckoutTools(server);
	registerCartPreviewTools(server);

	// Phase F2: expose ui:// resources for MCP Apps-aware hosts. Tools
	// reference them via `_meta.ui.resourceUri` in F4+; hosts without
	// MCP Apps support simply ignore unknown resources.
	registerAllAppResources(server);

	return server;
}
