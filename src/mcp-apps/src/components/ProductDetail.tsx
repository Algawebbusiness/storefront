/**
 * Polymorphic product detail view (Phase F5).
 *
 * Handles both modes of `ProductDetailPayload`:
 *
 *   - `single`  — media gallery + info column (name, category, price,
 *     description, variant pills, attribute table, Add-to-cart CTA).
 *   - `compare` — side-by-side cards (2–5 products) with thumb, name,
 *     price, in-stock badge, and inline attribute summary. Lays out as
 *     auto-column grid so the host iframe can scroll horizontally on
 *     narrow displays.
 *
 * Variant state is owned here so the CTA always reflects the currently
 * picked variant. Add-to-cart click hands off to `onAddToCart(variantId)`;
 * the entry forwards through `bridge.callTool("create_checkout", ...)`.
 * The iframe never carries `api_key` — host preserves agent identity
 * across the relay (threat-model §3 credential row).
 */

import { useMemo, useState } from "react";
import { AttributeTable } from "./AttributeTable";
import { MediaGallery } from "./MediaGallery";
import { VariantSelector } from "./VariantSelector";
import type { ProductDetailPayload, ProductFull } from "../types";

export interface ProductDetailProps {
	payload: ProductDetailPayload | null;
	onAddToCart?: (variantId: string) => void;
	onSelectCompare?: (slug: string) => void;
}

function formatPrice(price: ProductFull["price"]): string {
	const fmt = (amount: number) => {
		try {
			return new Intl.NumberFormat(undefined, {
				style: "currency",
				currency: price.currency || "USD",
				maximumFractionDigits: 2,
			}).format(amount);
		} catch {
			return `${amount.toFixed(2)} ${price.currency}`.trim();
		}
	};
	if (price.max === null || price.max === price.min) return fmt(price.min);
	return `${fmt(price.min)} – ${fmt(price.max)}`;
}

function SingleDetail({
	product,
	onAddToCart,
}: {
	product: ProductFull;
	onAddToCart?: (variantId: string) => void;
}) {
	const firstAvailable = useMemo(
		() => product.variants.find((v) => v.inStock)?.id ?? product.variants[0]?.id ?? null,
		[product.variants],
	);
	const [selectedId, setSelectedId] = useState<string | null>(firstAvailable);

	const selectedVariant = product.variants.find((v) => v.id === selectedId) ?? null;
	const canAddToCart = Boolean(selectedId) && (selectedVariant?.inStock ?? product.inStock);

	return (
		<div className="pd-root pd-root--single">
			<MediaGallery images={product.images} alt={product.name} />
			<div className="pd-info">
				<div>
					{product.category && <p className="pd-header__category">{product.category}</p>}
					<h1 className="pd-header__name">{product.name}</h1>
					<p className="pd-header__type">{product.productType}</p>
				</div>
				<p className="pd-price">
					{formatPrice(product.price)}
					<span className={`pd-price__stock${product.inStock ? "" : " pd-price__stock--out"}`}>
						{product.inStock ? "In stock" : "Out of stock"}
					</span>
				</p>
				{product.description && <div className="pd-description">{product.description}</div>}
				<VariantSelector variants={product.variants} selectedId={selectedId} onChange={setSelectedId} />
				<AttributeTable attributes={product.attributes} />
				<button
					type="button"
					className="pd-cta"
					disabled={!canAddToCart}
					onClick={() => selectedId && onAddToCart?.(selectedId)}
				>
					{canAddToCart ? "Add to cart" : "Unavailable"}
				</button>
			</div>
		</div>
	);
}

function CompareGrid({ products, onSelect }: { products: ProductFull[]; onSelect?: (slug: string) => void }) {
	return (
		<div className="pd-compare">
			<div
				className="pd-compare__grid"
				style={{ gridTemplateColumns: `repeat(${products.length}, minmax(180px, 1fr))` }}
			>
				{products.map((p) => {
					const thumb = p.images[0];
					return (
						<button
							key={p.slug}
							type="button"
							className="pd-compare__col"
							onClick={() => onSelect?.(p.slug)}
							aria-label={`View ${p.name}`}
						>
							<div className="pd-compare__thumb">
								{thumb ? (
									// eslint-disable-next-line @next/next/no-img-element -- iframe bundle
									<img src={thumb.url} alt={thumb.alt ?? ""} loading="lazy" />
								) : (
									<span className="mg-empty">No image</span>
								)}
							</div>
							<div className="pd-compare__row">
								{p.category && <span>{p.category}</span>}
								<strong>{p.name}</strong>
							</div>
							<div className="pd-compare__row">
								<span>Price</span>
								<strong>{formatPrice(p.price)}</strong>
							</div>
							<div className="pd-compare__row">
								<span>Availability</span>
								<strong style={{ color: p.inStock ? "var(--success)" : "var(--destructive)" }}>
									{p.inStock ? "In stock" : "Out of stock"}
								</strong>
							</div>
							<div className="pd-compare__row">
								<span>Variants</span>
								<strong>{p.variants.length}</strong>
							</div>
						</button>
					);
				})}
			</div>
		</div>
	);
}

export function ProductDetail({ payload, onAddToCart, onSelectCompare }: ProductDetailProps) {
	if (payload === null) {
		return <div className="pl-loading">Loading product…</div>;
	}
	if (payload.mode === "single") {
		return <SingleDetail product={payload.product} onAddToCart={onAddToCart} />;
	}
	return <CompareGrid products={payload.products} onSelect={onSelectCompare} />;
}
