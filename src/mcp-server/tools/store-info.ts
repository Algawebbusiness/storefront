import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { brandConfig } from "@/config/brand";
import { getBaseUrl } from "@/lib/seo";

export function registerStoreInfoTools(server: McpServer) {
	server.tool(
		"get_store_info",
		"Get store information: name, contact details, return policy, and links.",
		{},
		async () => {
			const baseUrl = getBaseUrl();

			const info = {
				name: brandConfig.siteName,
				organization: brandConfig.organizationName,
				tagline: brandConfig.tagline,
				url: baseUrl,
				contact: {
					email: brandConfig.contactEmail,
					phone: brandConfig.contactPhone,
				},
				social: {
					twitter: brandConfig.social.twitter ? `https://twitter.com/${brandConfig.social.twitter}` : null,
					instagram: brandConfig.social.instagram
						? `https://instagram.com/${brandConfig.social.instagram}`
						: null,
					facebook: brandConfig.social.facebook,
				},
				policies: {
					returns: "14 days without reason",
				},
			};

			return {
				content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }],
			};
		},
	);
}
