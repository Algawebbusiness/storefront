/**
 * UCP REST — Catalog product detail
 *
 * GET /api/ucp/rest/catalog/products/:slug
 *
 * Returns a full UCP catalog item including variants and structured attributes.
 * Cached for 5 minutes.
 */

import { mapProductToCatalogItem } from "@/lib/protocols/shared/catalog-mapper";
import {
	CATALOG_PRODUCT_BY_SLUG_QUERY,
	type CatalogProductBySlugData,
} from "@/lib/protocols/shared/catalog-queries";
import { signedJsonResponse } from "@/lib/protocols/shared/response";
import { withUcpRoute } from "@/lib/protocols/shared/route-handler";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { getDefaultChannel, saleorQuery } from "@/mcp-server/saleor-client";

interface ProductParams {
	slug: string;
}

export const GET = withUcpRoute<ProductParams>(
	{
		action: "catalog.product_detail",
		scope: "catalog.read",
		resourceId: (p) => p.slug,
	},
	async (_request, auth, { slug }) => {
		const channel = getDefaultChannel();
		const result = await saleorQuery<CatalogProductBySlugData>(CATALOG_PRODUCT_BY_SLUG_QUERY, {
			slug,
			channel,
		});

		if (!result.ok) {
			return signedJsonResponse({ error: { code: "server_error", message: result.error } }, { status: 500 });
		}

		if (!result.data.product) {
			return signedJsonResponse(
				{ error: { code: "not_found", message: `Product ${slug} not found` } },
				{ status: 404 },
			);
		}

		const ucpMeta = await buildUcpMeta(auth.profileUrl);
		return signedJsonResponse({
			ucp: ucpMeta,
			item: mapProductToCatalogItem(result.data.product, channel, { includeVariants: true }),
		});
	},
);
