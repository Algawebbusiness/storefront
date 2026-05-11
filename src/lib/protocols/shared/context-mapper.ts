/**
 * UCP `context` ⇆ Saleor metadata bridge (Phase A7).
 *
 * Saleor `Checkout`/`Order` carry a flat `[{key, value}]` metadata array.
 * UCP context is a small structured object. This module owns the mapping in
 * both directions plus the validation rules from the plan:
 *
 *   - `intent`            → metadata key `intent`, max 500 chars
 *   - `buyer_preferences` → metadata key `buyer_preferences` (JSON-stringified), max 2000 chars
 *   - `session_id`        → metadata key `agent_session_id`
 *
 * No `ucp.` prefix on keys: per A7 plan, agents and merchant-side dashboards
 * read these directly. Reserve a future migration if collisions show up.
 */

import type { UcpContext } from "./types";

export const META_KEY_INTENT = "intent";
export const META_KEY_BUYER_PREFERENCES = "buyer_preferences";
export const META_KEY_SESSION_ID = "agent_session_id";

const MAX_INTENT_LENGTH = 500;
const MAX_BUYER_PREFERENCES_JSON_LENGTH = 2000;

export interface SaleorMetadataItem {
	key: string;
	value: string;
}

export interface ContextValidationError {
	field: "intent" | "buyer_preferences" | "session_id";
	message: string;
}

export interface ContextValidationResult {
	ok: boolean;
	errors: ContextValidationError[];
	/** Stringified buyer_preferences cached during validation, reused by the metadata writer. */
	buyerPreferencesJson?: string;
}

/**
 * Validate a UcpContext against the length / type rules from the A7 plan.
 * Returns structured errors instead of throwing — routes turn them into 400s.
 */
export function validateContext(context: UcpContext | undefined): ContextValidationResult {
	const errors: ContextValidationError[] = [];
	if (!context) return { ok: true, errors };

	if (context.intent !== undefined) {
		if (typeof context.intent !== "string") {
			errors.push({ field: "intent", message: "intent must be a string" });
		} else if (context.intent.length > MAX_INTENT_LENGTH) {
			errors.push({
				field: "intent",
				message: `intent must be ≤${MAX_INTENT_LENGTH} characters (got ${context.intent.length})`,
			});
		}
	}

	let buyerPreferencesJson: string | undefined;
	if (context.buyer_preferences !== undefined) {
		if (
			typeof context.buyer_preferences !== "object" ||
			context.buyer_preferences === null ||
			Array.isArray(context.buyer_preferences)
		) {
			errors.push({
				field: "buyer_preferences",
				message: "buyer_preferences must be a JSON object",
			});
		} else {
			try {
				buyerPreferencesJson = JSON.stringify(context.buyer_preferences);
				if (buyerPreferencesJson.length > MAX_BUYER_PREFERENCES_JSON_LENGTH) {
					errors.push({
						field: "buyer_preferences",
						message: `buyer_preferences serialized to ${buyerPreferencesJson.length} chars; max ${MAX_BUYER_PREFERENCES_JSON_LENGTH}`,
					});
				}
			} catch {
				errors.push({
					field: "buyer_preferences",
					message: "buyer_preferences could not be JSON-serialized",
				});
			}
		}
	}

	if (context.session_id !== undefined && typeof context.session_id !== "string") {
		errors.push({ field: "session_id", message: "session_id must be a string" });
	}

	return errors.length === 0
		? { ok: true, errors: [], ...(buyerPreferencesJson !== undefined ? { buyerPreferencesJson } : {}) }
		: { ok: false, errors };
}

/**
 * Build a Saleor `MetadataInput[]` array from a validated context.
 * Pass the `buyerPreferencesJson` returned by validateContext to avoid
 * stringifying twice. Returns `null` when there's nothing to write.
 */
export function contextToMetadataInput(
	context: UcpContext | undefined,
	buyerPreferencesJson?: string,
): SaleorMetadataItem[] | null {
	if (!context) return null;
	const items: SaleorMetadataItem[] = [];
	if (context.intent !== undefined) {
		items.push({ key: META_KEY_INTENT, value: context.intent });
	}
	if (context.buyer_preferences !== undefined) {
		const json = buyerPreferencesJson ?? JSON.stringify(context.buyer_preferences);
		items.push({ key: META_KEY_BUYER_PREFERENCES, value: json });
	}
	if (context.session_id !== undefined) {
		items.push({ key: META_KEY_SESSION_ID, value: context.session_id });
	}
	return items.length > 0 ? items : null;
}

/**
 * Extract the UCP context from Saleor metadata. Unknown keys are ignored;
 * malformed `buyer_preferences` JSON is silently dropped (we never want a
 * stale write to break a fresh read).
 */
export function extractContextFromMetadata(
	metadata: SaleorMetadataItem[] | null | undefined,
): UcpContext | undefined {
	if (!metadata || metadata.length === 0) return undefined;

	const out: UcpContext = {};
	let touched = false;

	for (const item of metadata) {
		if (item.key === META_KEY_INTENT) {
			out.intent = item.value;
			touched = true;
		} else if (item.key === META_KEY_BUYER_PREFERENCES) {
			try {
				const parsed = JSON.parse(item.value) as unknown;
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
					out.buyer_preferences = parsed as Record<string, unknown>;
					touched = true;
				}
			} catch {
				// Stored value was malformed — skip rather than throw.
			}
		} else if (item.key === META_KEY_SESSION_ID) {
			out.session_id = item.value;
			touched = true;
		}
	}

	return touched ? out : undefined;
}
