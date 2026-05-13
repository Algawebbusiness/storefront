/**
 * `ui://saleor/product-list.html` entry (Phase F4).
 *
 * Wired to `search_products` + `get_category_products` (both ship the
 * same `ProductListPayload`). Bridge subscribes to tool results, hands
 * the parsed payload to <ProductList />. Clicking a card calls
 * `get_product_detail` through the host, which surfaces the F5 view.
 */

import { createRoot } from "react-dom/client";
import { createBridge } from "../bridge";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { ProductList } from "../components/ProductList";
import type { ProductListPayload } from "../types";
import "../components/tokens.css";

const bridge = createBridge<ProductListPayload>("saleor-product-list");
const rootEl = document.getElementById("root");
if (rootEl) {
	const root = createRoot(rootEl);

	const handleSelect = (slug: string) => {
		void bridge.callTool("get_product_detail", { slug });
	};

	function render(state: ProductListPayload | null) {
		root.render(
			<ErrorBoundary view="product-list" sendUiMessage={bridge.sendUiMessage}>
				<ProductList payload={state} onSelect={handleSelect} />
			</ErrorBoundary>,
		);
	}

	render(null);
	bridge.onResult(render);
}
