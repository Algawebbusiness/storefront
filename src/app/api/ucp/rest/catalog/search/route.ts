/**
 * UCP REST — Catalog search
 *
 * GET /api/ucp/rest/catalog/search?q=&category=&min_price=&max_price=&cursor=&limit=
 *
 * Query params:
 *   q          — free-text search across name + description
 *   category   — Saleor category ID (Relay-style, base64). Slug-based lookup TBD.
 *   min_price  — minimum gross price in major units (e.g. 99.50)
 *   max_price  — maximum gross price in major units
 *   cursor     — opaque cursor for the next page (from `next_cursor` of the previous response)
 *   limit      — page size (default 24, max 100)
 *
 * Note on pagination: the plan mentions `?page=`, but Saleor only supports
 * cursor-based pagination. We expose `cursor` (Relay endCursor) and return
 * `next_cursor` + `has_next_page` so agents can iterate.
 *
 * Response is signed (UCP-Signature header) and cached for 5 minutes.
 */

import { mapProductToCatalogItem } from "@/lib/protocols/shared/catalog-mapper";
import { CATALOG_SEARCH_QUERY, type CatalogSearchData } from "@/lib/protocols/shared/catalog-queries";
import { signedJsonResponse } from "@/lib/protocols/shared/response";
import { withUcpRoute } from "@/lib/protocols/shared/route-handler";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { getDefaultChannel, saleorQuery } from "@/mcp-server/saleor-client";

export const revalidate = 300;

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

interface ProductFilterInput {
	search?: string;
	categories?: string[];
	price?: { gte?: number; lte?: number };
}

export const GET = withUcpRoute(
	{ action: "catalog.search", scope: "catalog.read" },
	async (request, auth) => {
		const url = new URL(request.url);
		const q = url.searchParams.get("q") ?? undefined;
		const category = url.searchParams.get("category") ?? undefined;
		const minPriceRaw = url.searchParams.get("min_price");
		const maxPriceRaw = url.searchParams.get("max_price");
		const cursor = url.searchParams.get("cursor") ?? undefined;
		const limitRaw = url.searchParams.get("limit");

		const limit = clampLimit(limitRaw);
		if (limit === null) {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: `limit must be 1..${MAX_LIMIT}` } },
				{ status: 400 },
			);
		}

		const filter: ProductFilterInput = {};
		if (q) filter.search = q;
		if (category) filter.categories = [category];

		const minPrice = parsePrice(minPriceRaw);
		const maxPrice = parsePrice(maxPriceRaw);
		if (minPriceRaw !== null && minPrice === null) {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "min_price must be a non-negative number" } },
				{ status: 400 },
			);
		}
		if (maxPriceRaw !== null && maxPrice === null) {
			return signedJsonResponse(
				{ error: { code: "bad_request", message: "max_price must be a non-negative number" } },
				{ status: 400 },
			);
		}
		if (minPrice !== null || maxPrice !== null) {
			filter.price = {};
			if (minPrice !== null) filter.price.gte = minPrice;
			if (maxPrice !== null) filter.price.lte = maxPrice;
		}

		const channel = getDefaultChannel();
		const result = await saleorQuery<CatalogSearchData>(CATALOG_SEARCH_QUERY, {
			channel,
			first: limit,
			after: cursor,
			filter: Object.keys(filter).length > 0 ? filter : null,
		});

		if (!result.ok) {
			return signedJsonResponse(
				{ error: { code: "server_error", message: result.error } },
				{ status: 500 },
			);
		}

		const items = result.data.products.edges.map((edge) =>
			mapProductToCatalogItem(edge.node, channel, { includeVariants: false }),
		);

		const ucpMeta = await buildUcpMeta(auth.profileUrl);
		return signedJsonResponse({
			ucp: ucpMeta,
			items,
			total_count: result.data.products.totalCount,
			page_info: {
				has_next_page: result.data.products.pageInfo.hasNextPage,
				next_cursor: result.data.products.pageInfo.endCursor,
			},
		});
	},
);

function clampLimit(raw: string | null): number | null {
	if (raw === null) return DEFAULT_LIMIT;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) return null;
	return n;
}

function parsePrice(raw: string | null): number | null {
	if (raw === null) return null;
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 0) return null;
	return n;
}
