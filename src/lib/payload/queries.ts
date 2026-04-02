/**
 * Payload CMS query helpers.
 *
 * Pre-built functions for fetching standard Payload collections.
 * All return null when Payload is not configured (graceful degradation).
 */

import { payloadFetch } from "./client";
import type {
	PayloadListResponse,
	PayloadPost,
	PayloadPage,
	PayloadProductEnrichment,
	PayloadNavigation,
} from "./types";

// ============================================================================
// Blog Posts
// ============================================================================

/** Fetch published blog posts with pagination */
export async function getPublishedPosts(
	page = 1,
	limit = 12,
): Promise<PayloadListResponse<PayloadPost> | null> {
	const params = new URLSearchParams({
		"where[status][equals]": "published",
		sort: "-publishedAt",
		page: String(page),
		limit: String(limit),
		depth: "1", // Populate one level (coverImage, author)
	});

	return payloadFetch<PayloadListResponse<PayloadPost>>(`/posts?${params}`);
}

/** Fetch a single published post by slug */
export async function getPostBySlug(slug: string): Promise<PayloadPost | null> {
	const params = new URLSearchParams({
		"where[slug][equals]": slug,
		"where[status][equals]": "published",
		depth: "1",
		limit: "1",
	});

	const result = await payloadFetch<PayloadListResponse<PayloadPost>>(`/posts?${params}`);
	return result?.docs[0] ?? null;
}

// ============================================================================
// Static Pages
// ============================================================================

/** Fetch a published page by slug */
export async function getPageBySlug(slug: string): Promise<PayloadPage | null> {
	const params = new URLSearchParams({
		"where[slug][equals]": slug,
		"where[status][equals]": "published",
		depth: "1",
		limit: "1",
	});

	const result = await payloadFetch<PayloadListResponse<PayloadPage>>(`/pages?${params}`);
	return result?.docs[0] ?? null;
}

// ============================================================================
// Product Enrichment
// ============================================================================

/** Fetch enrichment data for a Saleor product */
export async function getProductEnrichment(
	saleorProductId: string,
): Promise<PayloadProductEnrichment | null> {
	const params = new URLSearchParams({
		"where[saleorProductId][equals]": saleorProductId,
		depth: "1",
		limit: "1",
	});

	const result = await payloadFetch<PayloadListResponse<PayloadProductEnrichment>>(
		`/product-enrichment?${params}`,
	);
	return result?.docs[0] ?? null;
}

// ============================================================================
// Navigation
// ============================================================================

/** Fetch navigation menu by slug (e.g., "header", "footer") */
export async function getNavigation(slug: string): Promise<PayloadNavigation | null> {
	const params = new URLSearchParams({
		"where[slug][equals]": slug,
		depth: "2", // Nested items
		limit: "1",
	});

	const result = await payloadFetch<PayloadListResponse<PayloadNavigation>>(
		`/navigation?${params}`,
		300, // 5 min cache for navigation
	);
	return result?.docs[0] ?? null;
}
