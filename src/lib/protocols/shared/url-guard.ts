/**
 * SSRF guard for agent-supplied outbound URLs (e.g. `webhook_url`).
 *
 * An agent registers a `webhook_url` that the server later POSTs to. Without
 * validation this is a server-side request forgery primitive: the agent points
 * it at cloud metadata (169.254.169.254), localhost admin ports, or internal
 * services (CWE-918).
 *
 * This guard is intentionally edge-runtime safe — pure JS, no `node:dns`, no
 * `node:net`. It therefore validates the URL *syntactically* and blocks IP
 * literals in private/reserved ranges plus obvious internal hostnames. It does
 * NOT resolve DNS, so a public hostname that resolves to an internal IP (DNS
 * rebinding) is a residual risk best closed by the operator allowlist
 * (`UCP_WEBHOOK_ALLOWED_HOSTS`) and/or a network egress policy. Callers should
 * also use `redirect: "manual"` so a 3xx cannot bounce to an internal target.
 */

export type UrlGuardResult = { ok: true; url: URL } | { ok: false; reason: string };

/**
 * Optional operator allowlist of host suffixes (comma-separated), e.g.
 * "hooks.acme.com,callbacks.example.org". When set, the URL host must match one
 * of them exactly or as a dot-suffix; everything else is rejected and the
 * IP-range heuristics below are skipped (the operator vouches for these hosts).
 */
const ALLOWED_HOST_SUFFIXES = (process.env.UCP_WEBHOOK_ALLOWED_HOSTS || "")
	.split(",")
	.map((s) => s.trim().toLowerCase())
	.filter(Boolean);

function parseIPv4(host: string): [number, number, number, number] | null {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!m) return null;
	const octets = m.slice(1, 5).map((n) => Number(n));
	if (octets.some((n) => n > 255)) return null;
	return octets as [number, number, number, number];
}

function isPrivateOrReservedIPv4([a, b]: [number, number, number, number]): boolean {
	if (a === 0) return true; // 0.0.0.0/8 "this network"
	if (a === 10) return true; // private
	if (a === 127) return true; // loopback
	if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
	if (a === 172 && b >= 16 && b <= 31) return true; // private
	if (a === 192 && b === 168) return true; // private
	if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
	if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
	if (a >= 224) return true; // multicast (224/4) + reserved (240/4) + 255.255.255.255
	return false;
}

function isPrivateOrReservedIPv6(host: string): boolean {
	const h = host.toLowerCase();
	if (h === "::1" || h === "::") return true; // loopback / unspecified
	if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7 unique-local
	if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true; // fe80::/10 link-local
	if (h.startsWith("fec")) return true; // fec0::/10 deprecated site-local
	if (h.includes("::ffff:") && h.includes(".")) return true; // IPv4-mapped (e.g. ::ffff:127.0.0.1)
	return false;
}

/** Validate an agent-supplied outbound webhook URL. */
export function validateOutboundWebhookUrl(raw: string): UrlGuardResult {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { ok: false, reason: "invalid URL" };
	}

	if (url.protocol !== "https:") return { ok: false, reason: "URL must use https" };
	if (url.username || url.password) return { ok: false, reason: "credentials in URL not allowed" };

	let host = url.hostname.toLowerCase();
	// new URL keeps IPv6 hosts in brackets; strip for inspection.
	if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
	if (!host) return { ok: false, reason: "empty host" };

	// Operator allowlist short-circuits the heuristics.
	if (ALLOWED_HOST_SUFFIXES.length > 0) {
		const allowed = ALLOWED_HOST_SUFFIXES.some((s) => host === s || host.endsWith("." + s));
		return allowed ? { ok: true, url } : { ok: false, reason: "host not in UCP_WEBHOOK_ALLOWED_HOSTS" };
	}

	// Obvious internal hostnames.
	if (
		host === "localhost" ||
		host.endsWith(".localhost") ||
		host.endsWith(".internal") ||
		host.endsWith(".local") ||
		host === "metadata.google.internal"
	) {
		return { ok: false, reason: "internal hostname not allowed" };
	}

	const v4 = parseIPv4(host);
	if (v4) {
		if (isPrivateOrReservedIPv4(v4)) return { ok: false, reason: "private/reserved IPv4 address" };
		return { ok: true, url };
	}

	if (host.includes(":")) {
		// bare IPv6 literal
		if (isPrivateOrReservedIPv6(host)) return { ok: false, reason: "private/reserved IPv6 address" };
		return { ok: true, url };
	}

	// Numeric-only host (decimal/hex/octal IP encodings such as 2130706433 or
	// 0x7f000001) — reject rather than let the resolver normalize it to an IP.
	if (/^(0x[0-9a-f]+|\d+)$/.test(host)) {
		return { ok: false, reason: "numeric host not allowed" };
	}

	return { ok: true, url };
}
