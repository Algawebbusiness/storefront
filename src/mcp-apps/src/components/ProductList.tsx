/**
 * Product list view (Phase F4).
 *
 * Renders a `ProductListPayload` as a responsive grid of `ProductCard`s.
 *
 * Note on carousel: F4 plan called for embla-carousel-react, but iframe
 * sandboxes around MCP Apps hosts vary in how they handle passive event
 * listeners and pointer-down captures. A plain CSS grid is robust
 * everywhere and stays well under the 200 KB gzip budget. F9 can iterate
 * to a carousel once we have host-compat telemetry.
 *
 * Three render states:
 *   - `payload === null`  →  loading (initial render before host pushes
 *     the first `ui/notifications/tool-result`).
 *   - `payload.products.length === 0`  →  "no products" empty state.
 *   - otherwise  →  grid.
 */

import { ProductCard } from "./ProductCard";
import type { ProductListPayload } from "../types";

export interface ProductListProps {
	payload: ProductListPayload | null;
	onSelect?: (slug: string) => void;
}

export function ProductList({ payload, onSelect }: ProductListProps) {
	if (payload === null) {
		return <div className="pl-root pl-loading">Loading products…</div>;
	}

	if (payload.products.length === 0) {
		return (
			<div className="pl-root">
				<header className="pl-header">
					<strong>No products found</strong>
				</header>
				<div className="pl-empty">Try a different search or category.</div>
			</div>
		);
	}

	const showing = payload.products.length;
	const total = payload.totalCount;
	const countLabel =
		total > showing ? `Showing ${showing} of ${total}` : `${showing} result${showing === 1 ? "" : "s"}`;

	return (
		<div className="pl-root">
			<header className="pl-header">
				<strong>Products</strong>
				<span className="pl-header__count">{countLabel}</span>
			</header>
			<div className="pl-grid">
				{payload.products.map((p) => (
					<ProductCard key={p.slug} product={p} onSelect={onSelect} />
				))}
			</div>
		</div>
	);
}
