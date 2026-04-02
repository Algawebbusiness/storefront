/**
 * Payload CMS REST API client.
 *
 * Graceful degradation: returns null when PAYLOAD_API_URL is not configured.
 * This means the storefront works perfectly without Payload — blog pages
 * simply won't appear and product enrichment won't show.
 *
 * Cache strategy:
 * - Content (posts, pages): 1 hour (changes rarely)
 * - Navigation: 5 minutes (may change more often)
 * - Product enrichment: 1 hour
 */

const PAYLOAD_API_URL = process.env.PAYLOAD_API_URL;
const PAYLOAD_API_KEY = process.env.PAYLOAD_API_KEY;

/**
 * Check if Payload CMS is configured.
 * Use this to conditionally render blog links, enrichment sections, etc.
 */
export function isPayloadConfigured(): boolean {
	return !!PAYLOAD_API_URL;
}

/** Get the Payload media URL (handles relative and absolute URLs) */
export function getPayloadMediaUrl(url: string): string {
	if (url.startsWith("http")) return url;
	if (!PAYLOAD_API_URL) return url;
	// Remove /api suffix to get base URL
	const baseUrl = PAYLOAD_API_URL.replace(/\/api\/?$/, "");
	return `${baseUrl}${url}`;
}

/**
 * Fetch data from Payload REST API.
 *
 * @param path — API path (e.g., "/posts?where[status][equals]=published")
 * @param revalidate — ISR revalidation interval in seconds (default: 3600 = 1h)
 * @returns Parsed JSON data, or null if Payload is not configured or request fails
 */
export async function payloadFetch<T>(path: string, revalidate = 3600): Promise<T | null> {
	if (!PAYLOAD_API_URL) return null;

	const url = `${PAYLOAD_API_URL}${path}`;
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
	};

	if (PAYLOAD_API_KEY) {
		headers["Authorization"] = `users API-Key ${PAYLOAD_API_KEY}`;
	}

	try {
		const response = await fetch(url, {
			headers,
			next: { revalidate },
		});

		if (!response.ok) {
			if (response.status !== 404) {
				console.warn(`[Payload] ${path}: HTTP ${response.status}`);
			}
			return null;
		}

		return (await response.json()) as T;
	} catch (error) {
		console.warn(`[Payload] ${path}: ${error instanceof Error ? error.message : "fetch failed"}`);
		return null;
	}
}
