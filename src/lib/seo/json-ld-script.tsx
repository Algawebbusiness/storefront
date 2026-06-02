import { serializeJsonLd } from "./json-ld";

/**
 * Renders a JSON-LD `<script type="application/ld+json">` block with the
 * payload safely escaped (see `serializeJsonLd` — prevents `</script>`
 * breakout / stored XSS, CWE-79). Renders nothing when `data` is null.
 *
 * Use this at every call site instead of hand-writing
 * `dangerouslySetInnerHTML={{ __html: JSON.stringify(...) }}`.
 */
export function JsonLdScript({ data }: { data: object | null }) {
	const __html = serializeJsonLd(data);
	if (__html === null) return null;
	return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html }} />;
}
