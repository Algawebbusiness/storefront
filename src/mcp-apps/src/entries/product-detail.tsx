/**
 * `ui://saleor/product-detail.html` entry (Phase F5).
 *
 * Wired to both `get_product_detail` (single) and `compare_products`
 * (compare) — the discriminated `ProductDetailPayload` carries `mode`,
 * `ProductDetail` picks the renderer.
 *
 * Add-to-cart click forwards through `bridge.callTool("create_checkout",
 * { line_items: [{ variant_id, quantity: 1 }] })`. The iframe does NOT
 * supply `api_key` — host preserves agent identity from the originating
 * session per the threat-model credential boundary. Making
 * `create_checkout` accept iframe-relayed calls without an explicit key
 * is an F6 deliverable; in F5 the click is a smoke wire that exercises
 * the bridge plumbing.
 *
 * Compare-mode click on a card forwards to `get_product_detail` so the
 * host can swap the view from the compare grid into the single detail.
 */

import { createRoot } from "react-dom/client";
import { createBridge } from "../bridge";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ProductDetail } from "../components/ProductDetail";
import type { ProductDetailPayload } from "../types";
import "../components/tokens.css";

const bridge = createBridge<ProductDetailPayload>("saleor-product-detail");
const rootEl = document.getElementById("root");
if (rootEl) {
	const root = createRoot(rootEl);

	const handleAddToCart = (variantId: string) => {
		void bridge.callTool("create_checkout", {
			line_items: [{ variant_id: variantId, quantity: 1 }],
		});
	};

	const handleSelectCompare = (slug: string) => {
		void bridge.callTool("get_product_detail", { slug });
	};

	function render(state: ProductDetailPayload | null) {
		root.render(
			<ErrorBoundary view="product-detail" sendUiMessage={bridge.sendUiMessage}>
				<ProductDetail payload={state} onAddToCart={handleAddToCart} onSelectCompare={handleSelectCompare} />
			</ErrorBoundary>,
		);
	}

	render(null);
	bridge.onResult(render);
}
