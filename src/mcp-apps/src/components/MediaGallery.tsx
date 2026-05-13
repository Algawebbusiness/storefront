/**
 * Product media gallery (Phase F5).
 *
 * Top: the active image. Below: thumbnail strip — click swaps the active
 * image. `useState` is intentional; no global store needed for this scope.
 *
 * Images come from a Saleor origin allow-listed by `_meta.ui.csp.img-src`
 * (built by `csp.ts` from env). Off-list origins are blocked by the host's
 * sandbox; we render the empty placeholder when `images` is empty too.
 */

import { useState } from "react";
import type { ProductFull } from "../types";

export interface MediaGalleryProps {
	images: ProductFull["images"];
	alt: string;
}

export function MediaGallery({ images, alt }: MediaGalleryProps) {
	const [active, setActive] = useState(0);
	const safeActive = images.length > 0 ? Math.min(active, images.length - 1) : 0;
	const main = images[safeActive];

	return (
		<div className="mg-root">
			<div className="mg-main">
				{main ? (
					// eslint-disable-next-line @next/next/no-img-element -- iframe bundle, next/image not available
					<img src={main.url} alt={main.alt ?? alt} loading="lazy" />
				) : (
					<span className="mg-empty">No image</span>
				)}
			</div>
			{images.length > 1 && (
				<div className="mg-thumbs">
					{images.map((img, i) => (
						<button
							key={img.url}
							type="button"
							className="mg-thumb"
							aria-pressed={i === safeActive}
							aria-label={`View image ${i + 1}`}
							onClick={() => setActive(i)}
						>
							{/* eslint-disable-next-line @next/next/no-img-element -- iframe bundle, next/image not available */}
							<img src={img.url} alt="" loading="lazy" />
						</button>
					))}
				</div>
			)}
		</div>
	);
}
