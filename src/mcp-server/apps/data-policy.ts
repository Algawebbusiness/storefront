/**
 * Data classification table for MCP Apps payloads (Phase F3).
 *
 * Every field that flows through the iframe → host → MCP server hop is
 * classified into one of five privacy classes. The classification is
 * **referential** — it has no runtime gating mechanism (the canonical
 * spec mechanism for "iframe sees more than model" is the paired-tool
 * pattern, see `paired-tools.ts`). Instead this table powers:
 *
 *   1. **Tests** (data-policy.test.ts + per-view acceptance in F6/F7)
 *      that verify a model-facing tool response shape only contains
 *      `public` / `cart-state` fields.
 *   2. **Documentation** in `docs/mcp-apps-threat-model.md` — humans
 *      reading the threat model see exactly which Saleor / Stripe
 *      fields are considered PII.
 *   3. **D5 inheritance**: ARES-verified IČO/DIČ eligibility evidence
 *      automatically lands in `business-confidential` via the
 *      `eligibility.evidence.*` wildcard. No D-specific F-code change.
 *
 * Wildcards: a key ending in `.*` matches every dotted descendant
 * (`shipping_address.streetAddress1`, `shipping_address.country`, …).
 */

/**
 * Five privacy classes. Two are model-visible (`public`, `cart-state`);
 * the rest are paired-tool-only (`customer-pii`, `business-confidential`)
 * or must never appear in any payload at all (`credential`).
 */
export type DataClass = "public" | "cart-state" | "customer-pii" | "credential" | "business-confidential";

/**
 * The set of classes whose fields may appear in a **model-facing** tool
 * result. Other classes are restricted to the paired `_full` tool
 * (visibility: ["app"]) or, in the case of `credential`, never serialised.
 */
export const MODEL_VISIBLE_CLASSES: ReadonlySet<DataClass> = new Set(["public", "cart-state"]);

/** Inverse — fields that must NOT show up in a model-facing response. */
export const APP_ONLY_CLASSES: ReadonlySet<DataClass> = new Set(["customer-pii", "business-confidential"]);

export function isModelVisibleClass(cls: DataClass): boolean {
	return MODEL_VISIBLE_CLASSES.has(cls);
}

export function isAppOnlyClass(cls: DataClass): boolean {
	return APP_ONLY_CLASSES.has(cls);
}

/**
 * Field-path → class map.
 *
 * Path syntax: dot-notation. Trailing `.*` is a wildcard that matches
 * every direct or transitive descendant (e.g. `shipping_address.*`
 * matches `shipping_address.streetAddress1`).
 *
 * Adding a Saleor / Stripe field that MIGHT carry PII? Add it here in
 * the same PR. The per-view tests in F6/F7 grep the model-tool response
 * shape against this table; an unclassified PII field that slips into
 * a model response would still bypass policy, so the table needs to
 * stay close to the schemas.
 */
export const FIELD_CLASSES = {
	// ── Catalog (every field is public) ───────────────────────────────
	"product.id": "public",
	"product.name": "public",
	"product.slug": "public",
	"product.description": "public", // sanitized via sanitizeForLlm
	"product.thumbnail": "public",
	"product.media.*": "public",
	"product.price": "public",
	"product.inStock": "public",
	"product.isAvailableForPurchase": "public",
	"product.attributes.*": "public",
	"product.category": "public",
	"product.variants.*": "public",

	// ── Cart state (IDs + status, model may know) ─────────────────────
	"cart.id": "cart-state",
	"cart.currency": "cart-state",
	"cart.status": "cart-state",
	"cart.totals.*": "cart-state",
	"cart.lines.id": "cart-state",
	"cart.lines.quantity": "cart-state",
	"cart.lines.productName": "public",
	"cart.lines.variantName": "public",
	"cart.lines.thumbnail": "public",
	"cart.lines.unitPrice": "public",
	"cart.lines.lineTotal": "cart-state",
	"cart.warnings.*": "cart-state",
	"cart.applied_discounts.*": "cart-state",
	"cart.has_email": "cart-state", // boolean flag, not value
	"cart.has_shipping_address": "cart-state",
	"cart.has_delivery_method": "cart-state",
	"cart.eligibility_requirements.*": "cart-state",

	// ── Customer PII (paired-tool only) ───────────────────────────────
	"buyer.email": "customer-pii",
	"buyer.phone": "customer-pii",
	"buyer.firstName": "customer-pii",
	"buyer.lastName": "customer-pii",
	"buyer.companyName": "customer-pii", // IČO is in eligibility, but company name itself is identifying
	"shipping_address.*": "customer-pii",
	"billing_address.*": "customer-pii",

	// ── Business confidential (paired-tool only) ──────────────────────
	"eligibility.evidence.*": "business-confidential", // DOB, IČO, DIČ, license_id
	"pricing.custom_tier": "business-confidential",
	"pricing.b2b_discount_percent": "business-confidential",
	"agent.notes": "business-confidential", // merchant-internal annotations

	// ── Order receipt (mostly cart-state, address paired) ─────────────
	"order.id": "cart-state",
	"order.number": "cart-state",
	"order.status": "cart-state",
	"order.statusDisplay": "public",
	"order.created": "cart-state",
	"order.isPaid": "cart-state",
	"order.total": "cart-state",
	"order.currency": "cart-state",
	"order.lines.*": "public",
	"order.shipping_address": "customer-pii",
	"order.billing_address": "customer-pii",
	"order.userEmail": "customer-pii",
	"order.tracking_url": "cart-state",
	"order.deliveryMethod": "cart-state",

	// ── Credentials (NEVER serialised — listed for reviewer awareness)
	api_key: "credential",
	payment_token: "credential",
	oauth_jwt: "credential",
	saleor_token: "credential",
} as const satisfies Record<string, DataClass>;

/** Every classified path. Useful for exhaustive tests + linters. */
export const ALL_CLASSIFIED_PATHS: readonly string[] = Object.keys(FIELD_CLASSES);

/**
 * Look up a path's class. Wildcards (`a.b.*`) match any descendant of
 * `a.b.`. Returns `undefined` for unclassified paths — callers decide
 * whether to default-deny or warn.
 */
export function classifyPath(path: string): DataClass | undefined {
	const exact = (FIELD_CLASSES as Record<string, DataClass>)[path];
	if (exact !== undefined) return exact;
	for (const [pattern, cls] of Object.entries(FIELD_CLASSES) as [string, DataClass][]) {
		if (!pattern.endsWith(".*")) continue;
		const prefix = pattern.slice(0, -2); // drop ".*"
		if (path === prefix || path.startsWith(`${prefix}.`)) return cls;
	}
	return undefined;
}

/**
 * Walk an object and yield every leaf path. Arrays are descended into
 * but indices are not part of the path (we classify shapes, not
 * specific cardinalities).
 *
 * Used by data-policy tests to confirm a real mapper output's field
 * set against the classification table.
 */
export function* enumerateLeafPaths(obj: unknown, prefix = ""): Generator<string> {
	if (obj === null || obj === undefined) {
		if (prefix) yield prefix;
		return;
	}
	if (Array.isArray(obj)) {
		if (obj.length === 0) {
			if (prefix) yield prefix;
			return;
		}
		// Yield each element's paths under the same prefix (no [i]) so an
		// array of address objects collapses to one set of paths.
		for (const item of obj) yield* enumerateLeafPaths(item, prefix);
		return;
	}
	if (typeof obj === "object") {
		const entries = Object.entries(obj as Record<string, unknown>);
		if (entries.length === 0) {
			if (prefix) yield prefix;
			return;
		}
		for (const [k, v] of entries) {
			const path = prefix ? `${prefix}.${k}` : k;
			yield* enumerateLeafPaths(v, path);
		}
		return;
	}
	// Primitive (string/number/bool) — emit the path.
	if (prefix) yield prefix;
}
