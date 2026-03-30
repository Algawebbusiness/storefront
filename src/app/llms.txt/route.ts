import { brandConfig } from "@/config/brand";
import { getBaseUrl } from "@/lib/seo";

const DEFAULT_CHANNEL = process.env.NEXT_PUBLIC_DEFAULT_CHANNEL || "default-channel";

export async function GET() {
	const baseUrl = getBaseUrl();
	const channel = DEFAULT_CHANNEL;

	const content = `# ${brandConfig.siteName}

> ${brandConfig.tagline}

## Products

Product catalog is available at these URLs:
- [All products](${baseUrl}/${channel}/products): Complete product catalog
- [Categories](${baseUrl}/${channel}/categories): Products organized by category

## Structured Data

Every product page contains complete JSON-LD markup (schema.org/Product)
with prices, availability, variants, and images.

Category and collection pages contain CollectionPage + ItemList JSON-LD.

## For AI Agents

- [Product feed (JSON)](${baseUrl}/api/products/feed.json): Machine-readable feed of all products with prices, variants, and availability
- [MCP Server](${baseUrl}/mcp): Model Context Protocol server for structured access to product data

## Store Information

- Name: ${brandConfig.organizationName}${brandConfig.contactEmail ? `\n- Email: ${brandConfig.contactEmail}` : ""}${brandConfig.contactPhone ? `\n- Phone: ${brandConfig.contactPhone}` : ""}
- Returns: 14 days without reason

## Pages

- [Homepage](${baseUrl}/${channel})
`;

	return new Response(content, {
		headers: {
			"Content-Type": "text/markdown; charset=utf-8",
			"Cache-Control": "public, max-age=86400",
		},
	});
}
