import { type MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/seo";

const SALEOR_API_URL = process.env.NEXT_PUBLIC_SALEOR_API_URL;
const DEFAULT_CHANNEL = process.env.NEXT_PUBLIC_DEFAULT_CHANNEL || "default-channel";

/**
 * Lightweight GraphQL fetcher for sitemap queries.
 * Uses raw fetch instead of executePublicGraphQL to avoid pulling in
 * heavy fragments — sitemap only needs slugs and timestamps.
 */
async function sitemapQuery<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
	if (!SALEOR_API_URL) {
		console.warn("[sitemap] NEXT_PUBLIC_SALEOR_API_URL not set, returning empty sitemap");
		return null;
	}

	try {
		const res = await fetch(SALEOR_API_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query, variables }),
			next: { revalidate: 3600 },
		});

		if (!res.ok) {
			console.error(`[sitemap] Saleor API returned ${res.status}`);
			return null;
		}

		const json = (await res.json()) as { data?: T; errors?: unknown[] };
		if (json.errors) {
			console.error("[sitemap] GraphQL errors:", json.errors);
		}
		return json.data ?? null;
	} catch (error) {
		console.error("[sitemap] Failed to fetch:", error);
		return null;
	}
}

interface SitemapProductsData {
	products: {
		edges: Array<{ node: { slug: string; updatedAt: string } }>;
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
}

interface SitemapCategoriesData {
	categories: {
		edges: Array<{ node: { slug: string } }>;
	};
}

interface SitemapCollectionsData {
	collections: {
		edges: Array<{ node: { slug: string } }>;
	};
}

interface SitemapPagesData {
	pages: {
		edges: Array<{ node: { slug: string } }>;
	};
}

const PRODUCTS_QUERY = `
	query SitemapProducts($channel: String!, $first: Int!, $after: String) {
		products(channel: $channel, first: $first, after: $after) {
			edges { node { slug updatedAt } }
			pageInfo { hasNextPage endCursor }
		}
	}
`;

const CATEGORIES_QUERY = `
	query SitemapCategories($first: Int!) {
		categories(first: $first) {
			edges { node { slug } }
		}
	}
`;

const COLLECTIONS_QUERY = `
	query SitemapCollections($channel: String!, $first: Int!) {
		collections(channel: $channel, first: $first) {
			edges { node { slug } }
		}
	}
`;

const PAGES_QUERY = `
	query SitemapPages($first: Int!) {
		pages(first: $first) {
			edges { node { slug } }
		}
	}
`;

async function getAllProducts(): Promise<Array<{ slug: string; updatedAt: string }>> {
	const products: Array<{ slug: string; updatedAt: string }> = [];
	let after: string | null = null;
	let hasNextPage = true;

	while (hasNextPage) {
		const data: SitemapProductsData | null = await sitemapQuery<SitemapProductsData>(PRODUCTS_QUERY, {
			channel: DEFAULT_CHANNEL,
			first: 100,
			after,
		});

		if (!data) break;

		for (const edge of data.products.edges) {
			products.push(edge.node);
		}

		hasNextPage = data.products.pageInfo.hasNextPage;
		after = data.products.pageInfo.endCursor;
	}

	return products;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const baseUrl = getBaseUrl();
	const channel = DEFAULT_CHANNEL;

	const [products, categoriesData, collectionsData, pagesData] = await Promise.all([
		getAllProducts(),
		sitemapQuery<SitemapCategoriesData>(CATEGORIES_QUERY, { first: 100 }),
		sitemapQuery<SitemapCollectionsData>(COLLECTIONS_QUERY, { channel, first: 100 }),
		sitemapQuery<SitemapPagesData>(PAGES_QUERY, { first: 100 }),
	]);

	const categories = categoriesData?.categories.edges.map((e) => e.node) ?? [];
	const collections = collectionsData?.collections.edges.map((e) => e.node) ?? [];
	const pages = pagesData?.pages.edges.map((e) => e.node) ?? [];

	return [
		// Homepage
		{
			url: `${baseUrl}/${channel}`,
			lastModified: new Date(),
			changeFrequency: "daily",
			priority: 1.0,
		},

		// Products
		...products.map((p) => ({
			url: `${baseUrl}/${channel}/products/${p.slug}`,
			lastModified: new Date(p.updatedAt),
			changeFrequency: "weekly" as const,
			priority: 0.8,
		})),

		// Categories
		...categories.map((c) => ({
			url: `${baseUrl}/${channel}/categories/${c.slug}`,
			lastModified: new Date(),
			changeFrequency: "weekly" as const,
			priority: 0.7,
		})),

		// Collections
		...collections.map((c) => ({
			url: `${baseUrl}/${channel}/collections/${c.slug}`,
			lastModified: new Date(),
			changeFrequency: "weekly" as const,
			priority: 0.6,
		})),

		// Static pages
		...pages.map((p) => ({
			url: `${baseUrl}/${channel}/pages/${p.slug}`,
			lastModified: new Date(),
			changeFrequency: "monthly" as const,
			priority: 0.4,
		})),
	];
}
