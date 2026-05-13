/**
 * `ui://saleor/cart-preview.html` entry (Phase F6).
 *
 * Wired to the first paired tool of the F-stack: `get_cart` (model
 * paired) + `get_cart_full` (app paired) + standalone `update_cart_line`
 * (app-only). The same view also renders `create_checkout` /
 * `get_checkout` responses — both now return the same model-visible
 * `CartPreviewPayload` shape.
 *
 * Bridge wiring:
 *   - `onResult`     — host pushes a fresh `CartPreviewPayload` after
 *     every cart-mutating tool call; we re-render.
 *   - `callTool("update_cart_line", {checkout_id, line_id, quantity})`
 *     — stepper clicks. Iframe args carry NO PII (just IDs + quantity).
 *   - `sendUiMessage({kind: "cart.proceed_to_checkout", cart_id})`
 *     — typed-enum chat message. The iframe never controls the
 *     resulting natural-language string (threat-model §4).
 */

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createBridge } from "../bridge";
import { CartPreview } from "../components/CartPreview";
import { ErrorBoundary } from "../components/ErrorBoundary";
import type { CartPreviewPayload } from "../types";
import "../components/tokens.css";

const bridge = createBridge<CartPreviewPayload>("saleor-cart-preview");

function CartApp() {
	const [payload, setPayload] = useState<CartPreviewPayload | null>(null);

	useEffect(() => {
		bridge.onResult(setPayload);
	}, []);

	const handleQtyChange = (lineId: string, quantity: number) => {
		if (!payload) return;
		void bridge.callTool("update_cart_line", {
			checkout_id: payload.id,
			line_id: lineId,
			quantity,
		});
	};

	const handleProceed = (cartId: string) => {
		void bridge.sendUiMessage({ kind: "cart.proceed_to_checkout", cart_id: cartId });
	};

	return (
		<ErrorBoundary view="cart-preview" sendUiMessage={bridge.sendUiMessage}>
			<CartPreview payload={payload} onQtyChange={handleQtyChange} onProceed={handleProceed} />
		</ErrorBoundary>
	);
}

const rootEl = document.getElementById("root");
if (rootEl) {
	createRoot(rootEl).render(<CartApp />);
}
