/**
 * UCP REST — Catalog categories
 *
 * GET /api/ucp/rest/catalog/categories
 *
 * Returns top-level categories (level 0) with channel-scoped product counts and
 * up to 50 immediate children per category. Cached for 5 minutes.
 */

import { validateAgentApiKey } from "@/lib/protocols/shared/auth";
import { mapCategoryToCatalogCategory } from "@/lib/protocols/shared/catalog-mapper";
import { CATALOG_CATEGORIES_QUERY, type CatalogCategoriesData } from "@/lib/protocols/shared/catalog-queries";
import {
	signedJsonResponse,
	signedProtocolDisabled,
	signedUnauthorized,
} from "@/lib/protocols/shared/response";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { getDefaultChannel, saleorQuery } from "@/mcp-server/saleor-client";

export const revalidate = 300;

export async function GET(request: Request) {
	if (process.env.UCP_ENABLED !== "true") {
		return signedProtocolDisabled("UCP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return signedUnauthorized();
	}

	const channel = getDefaultChannel();
	const result = await saleorQuery<CatalogCategoriesData>(CATALOG_CATEGORIES_QUERY, {
		first: 100,
		channel,
	});

	if (!result.ok) {
		return signedJsonResponse({ error: { code: "server_error", message: result.error } }, { status: 500 });
	}

	const categories = result.data.categories.edges.map((edge) => mapCategoryToCatalogCategory(edge.node));

	const ucpMeta = await buildUcpMeta(auth.profileUrl);
	return signedJsonResponse({ ucp: ucpMeta, categories });
}
