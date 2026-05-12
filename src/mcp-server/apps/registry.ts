/**
 * Central registry of MCP Apps UI resources (Phase F2).
 *
 * Each entry pairs a `ui://saleor/<name>.html` URI (referenced from
 * `_meta.ui.resourceUri` on tools) with the bundle file path emitted by
 * `pnpm run build:mcp-apps` (relative to `src/mcp-apps/dist/`).
 *
 * Adding a view: append an entry here, drop a `views/<name>.html` +
 * `src/entries/<name>.tsx` in `src/mcp-apps/`, add the input to
 * `vite.config.ts`. The serve layer (`serve-html.ts`) auto-picks it up.
 *
 * Resource URIs follow the `ui://saleor/...` scheme — the `saleor`
 * subpath segment groups our views under a single namespace so a host
 * that aggregates multiple MCP servers doesn't collide URIs.
 */

export interface AppResource {
	/** `ui://` URI — must match `_meta.ui.resourceUri` on the referencing tool(s). */
	uri: string;
	/** Path under `src/mcp-apps/dist/` (Vite outputs to `views/<name>.html`). */
	bundle: string;
	/** Human-readable name shown in `resources/list`. */
	name: string;
}

export const APP_RESOURCES = {
	productCard: {
		uri: "ui://saleor/product-card.html",
		bundle: "views/product-card.html",
		name: "Product card",
	},
	productList: {
		uri: "ui://saleor/product-list.html",
		bundle: "views/product-list.html",
		name: "Product list",
	},
	productDetail: {
		uri: "ui://saleor/product-detail.html",
		bundle: "views/product-detail.html",
		name: "Product detail",
	},
	cartPreview: {
		uri: "ui://saleor/cart-preview.html",
		bundle: "views/cart-preview.html",
		name: "Cart preview",
	},
	checkoutSummary: {
		uri: "ui://saleor/checkout-summary.html",
		bundle: "views/checkout-summary.html",
		name: "Checkout summary",
	},
	orderReceipt: {
		uri: "ui://saleor/order-receipt.html",
		bundle: "views/order-receipt.html",
		name: "Order receipt",
	},
} as const satisfies Record<string, AppResource>;

export type AppResourceKey = keyof typeof APP_RESOURCES;
