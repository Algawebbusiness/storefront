/**
 * Shared payload types for MCP Apps views.
 *
 * F2 introduced the umbrella `AppPayload` constraint so the bridge stays
 * typed. F4 adds the first real payload shapes — `ProductCardPayload` +
 * `ProductListPayload` — shared verbatim between the server-side mappers
 * (`src/mcp-server/tools/search.ts`, `categories.ts`) and the client-side
 * components (`src/mcp-apps/src/components/ProductCard.tsx`, `ProductList.tsx`).
 *
 * F5–F7 will fill in `ProductDetailPayload`, `CartPreviewPayload`,
 * `CheckoutSummaryPayload`, `OrderReceiptPayload`.
 */

export interface AppPayloadBase {
	/** Discriminator surfaced by the server-side mapper for forward compat. */
	kind: string;
}

export type AppPayload = AppPayloadBase | Record<string, unknown>;

/**
 * Compact single-product view contract — used both as the standalone
 * `ui://saleor/product-card.html` payload and as a list item inside
 * `ProductListPayload`. Stays small on purpose: only the fields a card
 * actually renders (no description, no variant tree).
 *
 * `price.max` is `null` when the product has a single price point (i.e.
 * `priceRange.start.gross.amount === priceRange.stop.gross.amount`). The
 * card renders `min` then, no range.
 */
export interface ProductCardPayload {
	slug: string;
	name: string;
	thumbnail: string | null;
	price: { min: number; max: number | null; currency: string };
	inStock: boolean;
	category: string | null;
}

/**
 * Carousel / grid result shape for `search_products` and
 * `get_category_products`. `totalCount` is the unpaginated Saleor count;
 * `products` is the page actually returned.
 */
export interface ProductListPayload {
	totalCount: number;
	products: ProductCardPayload[];
}
