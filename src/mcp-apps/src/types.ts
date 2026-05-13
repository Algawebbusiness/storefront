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

/**
 * One variant row inside the detail view. `price` / `currency` are nullable
 * because Saleor can omit per-variant pricing when the variant inherits
 * the parent product's price range — the UI should fall back to the
 * parent's `price.min` in that case.
 */
export interface ProductVariantSummary {
	id: string;
	name: string;
	sku: string | null;
	inStock: boolean;
	quantityAvailable: number | null;
	price: number | null;
	currency: string | null;
	/** Attribute slug → joined human-readable value(s) (Saleor allows multi-value attributes). */
	attributes: Record<string, string>;
}

/**
 * Full product shape used by the F5 product-detail view.
 *
 * `description` is plain text — the server-side mapper has already
 * parsed any EditorJS rich-text JSON and run `sanitizeForLlm`. The
 * iframe never re-parses or `innerHTML`-s this string. `attributes`
 * preserves the Saleor multi-value shape (slug → string[]) so the
 * `AttributeTable` can join with the tenant's preferred separator.
 */
export interface ProductFull {
	name: string;
	slug: string;
	description: string | null;
	category: string | null;
	productType: string;
	inStock: boolean;
	price: { min: number; max: number | null; currency: string };
	images: { url: string; alt: string | null }[];
	variants: ProductVariantSummary[];
	attributes: Record<string, string[]>;
}

/**
 * Discriminated union used by both `get_product_detail` (single product
 * landing on the chat surface) and `compare_products` (2–5 products laid
 * out side-by-side). One UI resource handles both — the entry inspects
 * `mode` and picks the renderer.
 */
export type ProductDetailPayload =
	| { mode: "single"; product: ProductFull }
	| { mode: "compare"; products: ProductFull[] };

/**
 * One cart line in the preview view. Prices are MAJOR units (USD 9.99,
 * not 999 cents) because the iframe Intl.NumberFormat layer wants
 * floating-point currency for display. Money on the wire between
 * protocol REST routes still uses minor units (`UcpCartLine.unit_price`);
 * this shape is iframe-only.
 */
export interface CartLineSummary {
	id: string;
	variantId: string;
	productName: string;
	variantName: string;
	thumbnail: string | null;
	quantity: number;
	unitPrice: number;
	lineTotal: number;
}

/** Buyer / address tuple visible only to the paired `_full` app tool. */
export interface CartBuyerSummary {
	email: string | null;
	phone: string | null;
	firstName: string | null;
	lastName: string | null;
}

export interface CartAddressSummary {
	firstName: string;
	lastName: string;
	companyName: string;
	streetAddress1: string;
	streetAddress2: string;
	city: string;
	cityArea: string;
	postalCode: string;
	country: string;
	countryArea: string;
	phone: string;
}

/**
 * Model-visible cart preview payload — what `get_cart` (paired model)
 * returns. Carries IDs, line metadata, totals (major units), and a few
 * boolean flags that let the model gate the "Proceed to checkout" CTA
 * without ever seeing the underlying address/email values (threat-model
 * §2: `cart-state` class for the flags, `public` for everything else).
 *
 * NO buyer / address fields here. Those live on `CartPreviewFullPayload`
 * only and are accessible exclusively from the iframe via
 * `bridge.fetchAppData("get_cart", {checkout_id})`.
 */
export interface CartPreviewPayload {
	id: string;
	currency: string;
	lines: CartLineSummary[];
	totals: {
		subtotal: number;
		discount: number;
		shipping: number;
		tax: number;
		total: number;
	};
	warnings?: { code: string; message: string; line_id?: string }[];
	hasEmail: boolean;
	hasShippingAddress: boolean;
	hasDeliveryMethod: boolean;
}

/**
 * App-only extension over `CartPreviewPayload`. Returned by
 * `get_cart_full` (`visibility: ["app"]`, hidden from `tools/list`). The
 * iframe pulls this to render filled-in address forms / confirmation
 * details without the model ever seeing the raw PII.
 */
export interface CartPreviewFullPayload extends CartPreviewPayload {
	buyer: CartBuyerSummary;
	shipping_address: CartAddressSummary | null;
	billing_address: CartAddressSummary | null;
}
