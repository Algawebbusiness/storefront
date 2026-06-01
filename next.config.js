import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */
const config = {
	// Cache Components (Partial Prerendering)
	// Enables mixing static, cached, and dynamic content in a single route.
	// See: https://nextjs.org/docs/app/getting-started/cache-components
	cacheComponents: true,

	// SECURITY: don't advertise the framework/version (fingerprinting).
	poweredByHeader: false,

	// Optimize barrel file imports for better bundle size and cold start performance
	// See: https://vercel.com/blog/how-we-optimized-package-imports-in-next-js
	experimental: {
		optimizePackageImports: ["lucide-react", "lodash-es"],
		// Note: API rate limiting is handled by RequestQueue in src/lib/graphql.ts
		// (max 3 concurrent requests + 200ms delay between requests)
	},
	images: {
		remotePatterns: [
			{
				// Saleor Cloud CDN
				protocol: "https",
				hostname: "*.saleor.cloud",
			},
			{
				// Saleor Media (common pattern)
				protocol: "https",
				hostname: "*.media.saleor.cloud",
			},
			// SECURITY: never allow arbitrary remote hosts in production — the
			// Next image optimizer would become an open image proxy / SSRF vector
			// (server-side fetch of any URL). The wildcard is dev-only.
			...(process.env.NODE_ENV === "development" ? [{ hostname: "*" }] : []),
		],
	},
	typedRoutes: false,

	// Bundle the built MCP Apps single-file HTML views in the server output so
	// runtimes (standalone, Cloudflare Pages, Vercel) can read them at request
	// time from `src/mcp-apps/dist/`. Without this, the MCP server falls back
	// to plain text responses on production.
	outputFileTracingIncludes: {
		"/mcp": ["./src/mcp-apps/dist/**/*"],
		"/api/mcp/**": ["./src/mcp-apps/dist/**/*"],
	},

	// Used in the Dockerfile
	output:
		process.env.NEXT_OUTPUT === "standalone"
			? "standalone"
			: process.env.NEXT_OUTPUT === "export"
				? "export"
				: undefined,

	// Cache headers for static assets and API routes
	async headers() {
		const isDev = process.env.NODE_ENV === "development";
		// SECURITY: baseline hardening headers on every response.
		// X-Frame-Options: DENY also covers OAuth consent/login (must never be
		// framable -> clickjacking). A full Content-Security-Policy is deferred
		// to Block 1 (needs a per-request nonce for the inline JSON-LD <script>
		// blocks); see the remediation tracker in CLAUDE.md.
		const securityHeaders = [
			{ key: "X-Frame-Options", value: "DENY" },
			{ key: "X-Content-Type-Options", value: "nosniff" },
			{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
			{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
			// HSTS only in production (avoid pinning HTTPS during local dev).
			...(isDev
				? []
				: [
						{
							key: "Strict-Transport-Security",
							value: "max-age=63072000; includeSubDomains; preload",
						},
					]),
		];
		return [
			{
				source: "/(.*)",
				headers: securityHeaders,
			},
			// In development, prevent aggressive caching of dynamic chunks
			...(isDev
				? [
						{
							source: "/_next/static/chunks/:path*",
							headers: [{ key: "Cache-Control", value: "no-store, must-revalidate" }],
						},
					]
				: []),
			{
				// Static assets - cache for 1 year (immutable with hash in filename)
				source: "/_next/static/:path*",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=31536000, immutable",
					},
				],
			},
			{
				// Public folder assets - cache for 1 month (logos, favicons, etc.)
				source: "/(.*)\\.(ico|png|jpg|jpeg|gif|svg|webp|woff|woff2|webmanifest)",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=2592000, stale-while-revalidate=31536000",
					},
				],
			},
			{
				// OG Image API - cache for 1 day
				source: "/api/og",
				headers: [
					{
						key: "Cache-Control",
						value: "public, max-age=86400, stale-while-revalidate=604800",
					},
				],
			},
		];
	},

	// Logging configuration
	logging: {
		fetches: {
			fullUrl: process.env.NODE_ENV === "development",
		},
	},
};

export default withNextIntl(config);
