/**
 * Payload CMS collection types.
 *
 * These types match the standard Payload REST API response format.
 * Works with any Payload 3.x instance that has the expected collections.
 */

// ============================================================================
// Generic Payload Response
// ============================================================================

export interface PayloadListResponse<T> {
	docs: T[];
	totalDocs: number;
	totalPages: number;
	page: number;
	limit: number;
	hasNextPage: boolean;
	hasPrevPage: boolean;
	nextPage: number | null;
	prevPage: number | null;
}

// ============================================================================
// Media
// ============================================================================

export interface PayloadMedia {
	id: string;
	url: string;
	alt?: string;
	width?: number;
	height?: number;
	mimeType?: string;
	filename?: string;
}

// ============================================================================
// Posts (Blog)
// ============================================================================

export interface PayloadPost {
	id: string;
	title: string;
	slug: string;
	content: PayloadRichText;
	excerpt?: string;
	coverImage?: PayloadMedia | string;
	author?: {
		id: string;
		name: string;
	};
	publishedAt: string;
	status: "draft" | "published";
	seoTitle?: string;
	seoDescription?: string;
	tags?: string[];
	createdAt: string;
	updatedAt: string;
}

// ============================================================================
// Pages (Static Content)
// ============================================================================

export interface PayloadPage {
	id: string;
	title: string;
	slug: string;
	content: PayloadRichText;
	seoTitle?: string;
	seoDescription?: string;
	status: "draft" | "published";
	createdAt: string;
	updatedAt: string;
}

// ============================================================================
// Product Enrichment
// ============================================================================

export interface PayloadProductEnrichment {
	id: string;
	saleorProductId: string;
	tips?: string;
	extendedDescription?: PayloadRichText;
	usageGuide?: PayloadRichText;
	createdAt: string;
	updatedAt: string;
}

// ============================================================================
// Navigation
// ============================================================================

export interface PayloadNavigation {
	id: string;
	slug: string;
	items: PayloadNavItem[];
}

export interface PayloadNavItem {
	id?: string;
	label: string;
	url?: string;
	newTab?: boolean;
	children?: PayloadNavItem[];
}

// ============================================================================
// Rich Text (Lexical format — Payload 3.x default)
// ============================================================================

/**
 * Payload 3.x uses Lexical editor by default.
 * The content is stored as a serialized Lexical state.
 */
export interface PayloadRichText {
	root: {
		type: string;
		children: PayloadRichTextNode[];
		direction: "ltr" | "rtl" | null;
		format: string;
		indent: number;
		version: number;
	};
}

export interface PayloadRichTextNode {
	type: string;
	children?: PayloadRichTextNode[];
	text?: string;
	format?: number;
	tag?: string;
	listType?: "bullet" | "number" | "check";
	url?: string;
	newTab?: boolean;
	value?: PayloadMedia;
	direction?: "ltr" | "rtl" | null;
	indent?: number;
	version?: number;
}
