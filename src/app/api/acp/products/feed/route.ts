import { getBaseUrl } from "@/lib/seo";
import { mapProductToAcp, type SaleorProductNode } from "@/lib/protocols/acp/product-mapper";
import { protocolDisabledResponse, validateAgentApiKey, unauthorizedResponse } from "@/lib/protocols/shared/auth";

const SALEOR_API_URL = process.env.NEXT_PUBLIC_SALEOR_API_URL;
const DEFAULT_CHANNEL = process.env.NEXT_PUBLIC_DEFAULT_CHANNEL || "default-channel";

/**
 * ACP product feed endpoint.
 *
 * Returns the full product catalog in ACP format for OpenAI/ChatGPT ingestion.
 * Supports ETag/If-None-Match for efficient crawling.
 *
 * GET /api/acp/products/feed
 */

const PRODUCTS_QUERY = `
	query AcpFeedProducts($channel: String!, $first: Int!, $after: String) {
		products(channel: $channel, first: $first, after: $after) {
			edges {
				node {
					id
					name
					slug
					isAvailable
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

interface FeedQueryData {
	products: {
		edges: Array<{ node: SaleorProductNode }>;
		pageInfo: { hasNextPage: boolean; endCursor: string | null };
	};
}

async function fetchSaleorQuery<T>(query: string, variables: Record<string, unknown>): Promise<T | null> {
	if (!SALEOR_API_URL) return null;

	try {
		const res = await fetch(SALEOR_API_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ query, variables }),
			next: { revalidate: 900 },
		});

		if (!res.ok) return null;

		const json = (await res.json()) as { data?: T };
		return json.data ?? null;
	} catch {
		return null;
	}
}

export async function GET(request: Request) {
	if (process.env.ACP_ENABLED !== "true") {
		return protocolDisabledResponse("ACP");
	}

	// Validate agent authentication
	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return unauthorizedResponse();
	}

	const baseUrl = getBaseUrl();
	const channel = DEFAULT_CHANNEL;

	// Fetch all products with pagination
	const allProducts: SaleorProductNode[] = [];
	let after: string | null = null;
	let hasNextPage = true;

	while (hasNextPage) {
		const data: FeedQueryData | null = await fetchSaleorQuery<FeedQueryData>(PRODUCTS_QUERY, {
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

	const feed = allProducts.map((p) => mapProductToAcp(p, baseUrl, channel));

	// Generate ETag from product count + latest update
	const latestUpdate = allProducts.reduce((max, p) => (p.updatedAt > max ? p.updatedAt : max), "");
	const etag = `"acp-${allProducts.length}-${latestUpdate}"`;

	// Check If-None-Match for 304
	const ifNoneMatch = request.headers.get("If-None-Match");
	if (ifNoneMatch === etag) {
		return new Response(null, { status: 304 });
	}

	return Response.json(feed, {
		headers: {
			"Cache-Control": "public, max-age=900",
			ETag: etag,
			"Content-Type": "application/json",
		},
	});
}
