/**
 * UCP REST — Catalog product detail
 *
 * GET /api/ucp/rest/catalog/products/:slug
 *
 * Returns a full UCP catalog item including variants and structured attributes.
 * Cached for 5 minutes.
 */

import { validateAgentApiKey } from "@/lib/protocols/shared/auth";
import { mapProductToCatalogItem } from "@/lib/protocols/shared/catalog-mapper";
import {
	CATALOG_PRODUCT_BY_SLUG_QUERY,
	type CatalogProductBySlugData,
} from "@/lib/protocols/shared/catalog-queries";
import {
	signedJsonResponse,
	signedProtocolDisabled,
	signedUnauthorized,
} from "@/lib/protocols/shared/response";
import { buildUcpMeta } from "@/lib/protocols/ucp/capabilities";
import { getDefaultChannel, saleorQuery } from "@/mcp-server/saleor-client";

export const revalidate = 300;

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
	if (process.env.UCP_ENABLED !== "true") {
		return signedProtocolDisabled("UCP");
	}

	const auth = validateAgentApiKey(request);
	if (!auth.valid) {
		return signedUnauthorized();
	}

	const { slug } = await params;
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
}
