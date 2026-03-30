import {
	type WithContext,
	type Product,
	type BreadcrumbList,
	type Organization,
	type WebSite,
	type CollectionPage,
} from "schema-dts";
import { seoConfig, getBaseUrl } from "./config";
import { brandConfig } from "@/config/brand";

/**
 * Product JSON-LD structured data builder
 *
 * Creates Schema.org Product markup for rich Google search results.
 * This helps your products appear with prices, availability, and images in search.
 *
 * @see https://developers.google.com/search/docs/appearance/structured-data/product
 *
 * @example
 * const jsonLd = buildProductJsonLd({
 *   name: product.name,
 *   description: product.seoDescription,
 *   images: product.media?.map(m => m.url),
 *   sku: variant?.sku,
 *   brand: product.brand,
 *   url: `/products/${product.slug}`,
 *   price: { amount: 29.99, currency: "USD" },
 *   inStock: true,
 * });
 *
 * // In your page:
 * <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
 */
export function buildProductJsonLd(options: {
	name: string;
	description?: string;
	images?: string[];
	sku?: string | null;
	brand?: string | null;
	url?: string;
	/** Single variant pricing */
	price?: {
		amount: number;
		currency: string;
	} | null;
	/** Price range for products with variants */
	priceRange?: {
		lowPrice: number;
		highPrice: number;
		currency: string;
	} | null;
	inStock?: boolean;
	variantCount?: number;
}): WithContext<Product> | null {
	if (!seoConfig.enableJsonLd) {
		return null;
	}

	const {
		name,
		description,
		images,
		sku,
		brand,
		url,
		price,
		priceRange,
		inStock = true,
		variantCount,
	} = options;

	const baseUrl = getBaseUrl();
	const fullUrl = url ? `${baseUrl}${url}` : undefined;

	return {
		"@context": "https://schema.org",
		"@type": "Product",
		name,
		description: description || name,
		image: images && images.length > 0 ? images : undefined,
		...(sku && { sku }),
		brand: {
			"@type": "Brand",
			name: brand || seoConfig.defaultBrand,
		},
		offers: price
			? {
					"@type": "Offer",
					url: fullUrl,
					availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
					priceCurrency: price.currency,
					price: price.amount,
					seller: {
						"@type": "Organization",
						name: seoConfig.organizationName,
					},
				}
			: priceRange
				? {
						"@type": "AggregateOffer",
						url: fullUrl,
						availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
						priceCurrency: priceRange.currency,
						lowPrice: priceRange.lowPrice,
						highPrice: priceRange.highPrice,
						offerCount: variantCount,
						seller: {
							"@type": "Organization",
							name: seoConfig.organizationName,
						},
					}
				: undefined,
	};
}

/**
 * BreadcrumbList JSON-LD structured data builder
 *
 * @see https://developers.google.com/search/docs/appearance/structured-data/breadcrumb
 */
export function buildBreadcrumbListJsonLd(
	items: { name: string; url?: string }[],
): WithContext<BreadcrumbList> | null {
	if (!seoConfig.enableJsonLd || items.length === 0) return null;

	const baseUrl = getBaseUrl();

	return {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: items.map((item, index) => ({
			"@type": "ListItem" as const,
			position: index + 1,
			name: item.name,
			...(item.url && { item: `${baseUrl}${item.url}` }),
		})),
	};
}

/**
 * Organization JSON-LD structured data builder
 *
 * Uses brandConfig values. Render on the homepage.
 *
 * @see https://developers.google.com/search/docs/appearance/structured-data/organization
 */
export function buildOrganizationJsonLd(): WithContext<Organization> | null {
	if (!seoConfig.enableJsonLd) return null;

	const baseUrl = getBaseUrl();

	return {
		"@context": "https://schema.org",
		"@type": "Organization",
		name: brandConfig.organizationName,
		url: baseUrl,
		logo: `${baseUrl}${brandConfig.logoUrl}`,
		...(brandConfig.contactEmail && { email: brandConfig.contactEmail }),
		...(brandConfig.contactPhone && { telephone: brandConfig.contactPhone }),
		...(brandConfig.social.twitter && {
			sameAs: [`https://twitter.com/${brandConfig.social.twitter}`],
		}),
	};
}

/**
 * WebSite JSON-LD structured data builder with SearchAction
 *
 * Enables the sitelinks search box in Google results.
 *
 * @see https://developers.google.com/search/docs/appearance/structured-data/sitelinks-searchbox
 */
export function buildWebSiteJsonLd(channel: string): WithContext<WebSite> | null {
	if (!seoConfig.enableJsonLd) return null;

	const baseUrl = getBaseUrl();

	return {
		"@context": "https://schema.org",
		"@type": "WebSite",
		name: brandConfig.siteName,
		url: baseUrl,
		potentialAction: {
			"@type": "SearchAction",
			target: `${baseUrl}/${channel}/search?q={search_term_string}`,
			"query-input": "required name=search_term_string",
		} as unknown as import("schema-dts").SearchAction,
	};
}

/**
 * CollectionPage JSON-LD structured data builder
 *
 * For category and collection listing pages.
 *
 * @see https://developers.google.com/search/docs/appearance/structured-data/carousel
 */
export function buildCollectionPageJsonLd(options: {
	name: string;
	description?: string | null;
	url: string;
	items?: { name: string; url: string; image?: string }[];
}): WithContext<CollectionPage> | null {
	if (!seoConfig.enableJsonLd) return null;

	const baseUrl = getBaseUrl();
	const { name, description, url, items } = options;

	return {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		name,
		...(description && { description }),
		url: `${baseUrl}${url}`,
		...(items &&
			items.length > 0 && {
				mainEntity: {
					"@type": "ItemList",
					itemListElement: items.map((item, index) => ({
						"@type": "ListItem" as const,
						position: index + 1,
						name: item.name,
						url: `${baseUrl}${item.url}`,
						...(item.image && { image: item.image }),
					})),
				},
			}),
	};
}

/**
 * JSON-LD Script component helper
 *
 * @example
 * <script {...jsonLdScriptProps(productJsonLd)} />
 */
export function jsonLdScriptProps(data: object | null) {
	if (!data) return null;
	return {
		type: "application/ld+json",
		dangerouslySetInnerHTML: { __html: JSON.stringify(data) },
	};
}
