import { getBaseUrl } from "@/lib/seo";

const SALEOR_API_URL = process.env.NEXT_PUBLIC_SALEOR_API_URL;
const DEFAULT_CHANNEL = process.env.NEXT_PUBLIC_DEFAULT_CHANNEL || "default-channel";

const PRODUCTS_QUERY = `
	query FeedProducts($channel: String!, $first: Int!, $after: String) {
		products(channel: $channel, first: $first, after: $after) {
			edges {
				node {
					id
					name
					slug
					isAvailable
					created
					updatedAt
					description
					category {
						name
						slug
					}
					pricing {
						priceRange {
							start { gross { amount currency } }
							stop { gross { amount currency } }
						}
					}
					thumbnail(size: 1024, format: WEBP) {
						url
						alt
					}
					media {
						url
						alt
						type
					}
					variants {
						id
						name
						sku
						quantityAvailable
						pricing {
							price { gross { amount currency } }
						}
						attributes {
							attribute { slug name }
							values { name }
						}
					}
					attributes {
						attribute { slug name }
						values { name }
					}
				}
			}
			pageInfo {
				hasNextPage
				endCursor
			}
		}
	}
`;

interface ProductNode {
	id: string;
	name: string;
	slug: string;
	isAvailable: boolean;
	created: string;
	updatedAt: string;
	description: string | null;
	category: { name: string; slug: string } | null;
	pricing: {
		priceRange: {
			start: { gross: { amount: number; currency: string } };
			stop: { gross: { amount: number; currency: string } };
		};
	} | null;
	thumbnail: { url: string; alt: string | null } | null;
	media: Array<{ url: string; alt: string | null; type: string }>;
	variants: Array<{
		id: string;
		name: string;
		sku: string | null;
		quantityAvailable: number | null;
		pricing: { price: { gross: { amount: number; currency: string } } } | null;
		attributes: Array<{
			attribute: { slug: string; name: string };
			values: Array<{ name: string }>;
		}>;
	}>;
	attributes: Array<{
		attribute: { slug: string; name: string };
		values: Array<{ name: string }>;
	}>;
}

interface FeedQueryData {
	products: {
		edges: Array<{ node: ProductNode }>;
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
}

async function fetchQuery<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
	if (!SALEOR_API_URL) return null;

	try {
		const res = await fetch(SALEOR_API_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query, variables }),
			next: { revalidate: 3600 },
		});

		if (!res.ok) return null;

		const json = (await res.json()) as { data?: T };
		return json.data ?? null;
	} catch {
		return null;
	}
}

function stripHtml(text: string | null): string | null {
	if (!text) return null;
	try {
		const parsed = JSON.parse(text) as { blocks?: Array<{ data?: { text?: string } }> };
		if (parsed.blocks) {
			return parsed.blocks
				.map((b) => b.data?.text ?? "")
				.filter(Boolean)
				.join(" ");
		}
	} catch {
		// Not EditorJS JSON, treat as plain text
	}
	return text.replace(/<[^>]*>/g, "").trim() || null;
}

function mapProduct(node: ProductNode, baseUrl: string, channel: string) {
	return {
		id: node.id,
		name: node.name,
		slug: node.slug,
		url: `${baseUrl}/${channel}/products/${node.slug}`,
		category: node.category?.name ?? null,
		description: stripHtml(node.description),
		price: {
			currency: node.pricing?.priceRange?.start?.gross?.currency ?? null,
			min: node.pricing?.priceRange?.start?.gross?.amount ?? null,
			max: node.pricing?.priceRange?.stop?.gross?.amount ?? null,
		},
		inStock: node.isAvailable,
		variants: node.variants.map((v) => ({
			id: v.id,
			sku: v.sku,
			name: v.name,
			price: v.pricing?.price?.gross?.amount ?? null,
			inStock: (v.quantityAvailable ?? 0) > 0,
			attributes: v.attributes.reduce(
				(acc, a) => {
					acc[a.attribute.slug] = a.values[0]?.name ?? "";
					return acc;
				},
				{} as Record<string, string>,
			),
		})),
		images: node.media
			.filter((m) => m.type === "IMAGE")
			.map((m) => ({ url: m.url, alt: m.alt })),
		attributes: node.attributes.reduce(
			(acc, a) => {
				acc[a.attribute.slug] = a.values.map((v) => v.name);
				return acc;
			},
			{} as Record<string, string[]>,
		),
		updatedAt: node.updatedAt,
	};
}

export async function GET() {
	const baseUrl = getBaseUrl();
	const channel = DEFAULT_CHANNEL;

	const allProducts: ProductNode[] = [];
	let after: string | null = null;
	let hasNextPage = true;

	while (hasNextPage) {
		const data: FeedQueryData | null = await fetchQuery<FeedQueryData>(PRODUCTS_QUERY, {
			channel,
			first: 100,
			after,
		});

		if (!data) break;

		for (const edge of data.products.edges) {
			allProducts.push(edge.node);
		}

		hasNextPage = data.products.pageInfo.hasNextPage;
		after = data.products.pageInfo.endCursor;
	}

	const feed = allProducts.map((p) => mapProduct(p, baseUrl, channel));

	return Response.json(feed, {
		headers: {
			"Cache-Control": "public, max-age=3600",
		},
	});
}
