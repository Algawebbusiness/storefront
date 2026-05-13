/**
 * `ui://saleor/order-receipt.html` entry (Phase F7).
 *
 * Renders the post-pay receipt. Wired to `get_order` paired tools and
 * to `complete_checkout` (which also returns an `OrderReceiptPayload`
 * after a successful payment).
 *
 * On every fresh `OrderReceiptPayload`, fetch the paired `_full`
 * variant to surface the lines + addresses block. "View order" forwards
 * to `bridge.openLink` — F7 ships a relative `/order/<id>` URL because
 * no env-injected storefront origin lands until F8.
 */

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createBridge } from "../bridge";
import { OrderReceipt } from "../components/OrderReceipt";
import type { OrderReceiptFullPayload, OrderReceiptPayload } from "../types";
import "../components/tokens.css";

const bridge = createBridge<OrderReceiptPayload>("saleor-order-receipt");

interface FetchedFullPayload {
	content?: Array<{ type?: string; text?: string }>;
}

function extractText(result: FetchedFullPayload): string | null {
	const block = result.content?.find((c) => c.type === "text");
	return block?.text ?? null;
}

function tryParseFull(text: string): OrderReceiptFullPayload | null {
	const inner =
		text.replace(/^=== BEGIN ORDER-RECEIPT [^\n]*\n/, "").replace(/\n=== END ORDER-RECEIPT ===$/, "") || text;
	try {
		return JSON.parse(inner) as OrderReceiptFullPayload;
	} catch {
		return null;
	}
}

function OrderApp() {
	const [payload, setPayload] = useState<OrderReceiptPayload | null>(null);
	const [fullPayload, setFullPayload] = useState<OrderReceiptFullPayload | null>(null);

	useEffect(() => {
		bridge.onResult(setPayload);
	}, []);

	useEffect(() => {
		if (!payload) return;
		let cancelled = false;
		void (async () => {
			try {
				const full = await bridge.fetchAppData<FetchedFullPayload>("get_order", {
					order_id: payload.id,
				});
				if (cancelled) return;
				const text = extractText(full);
				if (text) setFullPayload(tryParseFull(text));
			} catch {
				// Order receipt is still useful with just the header info.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [payload]);

	const handleViewOrder = (orderId: string) => {
		// F8 plan: read `window.__STOREFRONT_URL__` injected by serve-html.
		// For now, hand the host a relative path — most hosts treat that as
		// "open in the same tab as the chat surface".
		void bridge.openLink(`/order/${orderId}`);
	};

	return <OrderReceipt payload={payload} fullPayload={fullPayload} onViewOrder={handleViewOrder} />;
}

const rootEl = document.getElementById("root");
if (rootEl) {
	createRoot(rootEl).render(<OrderApp />);
}
