/**
 * `ui://saleor/product-card.html` entry (Phase F4).
 *
 * No catalog tool is wired to this URI in F4 — `search_products` and
 * `get_category_products` both render through `product-list.html`. The
 * single-card view exists so F5+ tools (e.g. a future "feature this one
 * product" affordance) can mount the same `ProductCard` component with
 * a `ProductCardPayload`. Tool result handling, theming, and the bridge
 * shape stay identical to `product-list`.
 */

import { createRoot } from "react-dom/client";
import { createBridge } from "../bridge";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ProductCard } from "../components/ProductCard";
import type { ProductCardPayload } from "../types";
import "../components/tokens.css";

const bridge = createBridge<ProductCardPayload>("saleor-product-card");
const rootEl = document.getElementById("root");
if (rootEl) {
	const root = createRoot(rootEl);

	const handleSelect = (slug: string) => {
		void bridge.callTool("get_product_detail", { slug });
	};

	function render(state: ProductCardPayload | null) {
		root.render(
			<ErrorBoundary view="product-card" sendUiMessage={bridge.sendUiMessage}>
				{state === null ? (
					<div className="pl-loading">Loading…</div>
				) : (
					<div style={{ padding: "1rem" }}>
						<ProductCard product={state} onSelect={handleSelect} />
					</div>
				)}
			</ErrorBoundary>,
		);
	}

	render(null);
	bridge.onResult(render);
}
