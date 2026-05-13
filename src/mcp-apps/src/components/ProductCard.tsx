/**
 * Compact product card (Phase F4).
 *
 * Renders one `ProductCardPayload` — thumbnail, name, category label,
 * price (or range), out-of-stock badge. Stays presentational: parent
 * passes an `onSelect(slug)` to deal with the click. F5 reuses this
 * component inside the product detail "compare" mode.
 *
 * Styling lives in `tokens.css` (shared per-iframe). No Tailwind in
 * iframe bundles — we keep gzip under the 200 KB target.
 */

import type { ProductCardPayload } from "../types";

export interface ProductCardProps {
	product: ProductCardPayload;
	onSelect?: (slug: string) => void;
}

function formatPrice(price: ProductCardPayload["price"]): string {
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

export function ProductCard({ product, onSelect }: ProductCardProps) {
	const handleSelect = () => onSelect?.(product.slug);
	const handleKey = (e: React.KeyboardEvent<HTMLButtonElement>) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			handleSelect();
		}
	};

	return (
		<button
			type="button"
			className="pc-card"
			data-out-of-stock={!product.inStock}
			onClick={handleSelect}
			onKeyDown={handleKey}
			aria-label={`${product.name}${product.inStock ? "" : " (out of stock)"}`}
		>
			<div className={`pc-card__thumb${product.thumbnail ? "" : " pc-card__thumb--empty"}`}>
				{product.thumbnail ? (
					// eslint-disable-next-line @next/next/no-img-element -- iframe bundle, next/image not available
					<img src={product.thumbnail} alt="" loading="lazy" />
				) : (
					<span>No image</span>
				)}
				{!product.inStock && <span className="pc-card__badge">Out of stock</span>}
			</div>
			{product.category && <p className="pc-card__category">{product.category}</p>}
			<p className="pc-card__name">{product.name}</p>
			<p className="pc-card__price">{formatPrice(product.price)}</p>
		</button>
	);
}
