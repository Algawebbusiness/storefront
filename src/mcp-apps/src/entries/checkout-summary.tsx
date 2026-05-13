/**
 * `ui://saleor/checkout-summary.html` entry (Phase F7).
 *
 * Pre-pay review surface. Wired to `get_checkout` paired tools and the
 * app-only `update_checkout` mutator (both from F7) — clicking the
 * shipping picker fires `update_checkout` through the bridge; the
 * confirm-and-pay CTA fires a typed `ui/message` so the host LLM can
 * gather a Stripe payment token outside the iframe (threat-model §3:
 * the token never crosses the iframe boundary).
 *
 * Address fetch: on every fresh `CheckoutSummaryPayload`, we kick off
 * `bridge.fetchAppData("get_checkout", {checkout_id})` to pull the
 * paired `_full` payload (buyer + addresses). The full payload lives in
 * a separate state slot; the model-visible payload re-renders even
 * while the address fetch is in flight.
 */

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { createBridge } from "../bridge";
import { CheckoutSummary } from "../components/CheckoutSummary";
import type { CheckoutSummaryFullPayload, CheckoutSummaryPayload } from "../types";
import "../components/tokens.css";

const bridge = createBridge<CheckoutSummaryPayload>("saleor-checkout-summary");

interface FetchedFullPayload {
	content?: Array<{ type?: string; text?: string }>;
}

function extractText(result: FetchedFullPayload): string | null {
	const block = result.content?.find((c) => c.type === "text");
	return block?.text ?? null;
}

function tryParseFull(text: string): CheckoutSummaryFullPayload | null {
	// F4+ tool results are wrapped by `wrapAsData(..., "checkout-summary")`.
	const inner =
		text.replace(/^=== BEGIN CHECKOUT-SUMMARY [^\n]*\n/, "").replace(/\n=== END CHECKOUT-SUMMARY ===$/, "") ||
		text;
	try {
		return JSON.parse(inner) as CheckoutSummaryFullPayload;
	} catch {
		return null;
	}
}

function CheckoutApp() {
	const [payload, setPayload] = useState<CheckoutSummaryPayload | null>(null);
	const [fullPayload, setFullPayload] = useState<CheckoutSummaryFullPayload | null>(null);

	useEffect(() => {
		bridge.onResult(setPayload);
	}, []);

	useEffect(() => {
		if (!payload) return;
		let cancelled = false;
		void (async () => {
			try {
				const full = await bridge.fetchAppData<FetchedFullPayload>("get_checkout", {
					checkout_id: payload.id,
				});
				if (cancelled) return;
				const text = extractText(full);
				if (text) setFullPayload(tryParseFull(text));
			} catch {
				// Network/host error: model-visible payload still renders.
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [payload]);

	const handleSelectShipping = (methodId: string) => {
		if (!payload) return;
		void bridge.callTool("update_checkout", {
			checkout_id: payload.id,
			delivery_method_id: methodId,
		});
	};

	const handleConfirm = (cartId: string) => {
		void bridge.sendUiMessage({ kind: "checkout.confirm_requested", checkout_id: cartId });
	};

	return (
		<CheckoutSummary
			payload={payload}
			fullPayload={fullPayload}
			onSelectShipping={handleSelectShipping}
			onConfirm={handleConfirm}
		/>
	);
}

const rootEl = document.getElementById("root");
if (rootEl) {
	createRoot(rootEl).render(<CheckoutApp />);
}
