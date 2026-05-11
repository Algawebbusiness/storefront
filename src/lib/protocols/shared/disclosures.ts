/**
 * Regulatory disclosures + age-gating (Phase C5).
 *
 * Some product categories require warnings at sale time: alcohol (age check),
 * dietary supplements ("not a medicinal product"), recyclable-fee electronics,
 * etc. UCP 2026-04-08 standardises these as cart-level `warnings[]` and ties
 * them to eligibility requirements when consent / age is required.
 *
 * Driving data: a Saleor product attribute named `disclosure_type` whose
 * values are slugs from the keys of `DISCLOSURES` (e.g., `alcohol`,
 * `dietary_supplement`). The cart mapper reads these per line.
 *
 * Wiring:
 *   1. `buildLineDisclosures(line)` is called per line by the cart mapper.
 *      Returns the matching warning entries.
 *   2. `registerDisclosureEligibilityChecker()` is idempotently invoked once
 *      at cart-mapper module load. The checker walks each line, looks for
 *      `requires_eligibility` markers on the disclosure, and emits matching
 *      EligibilityRequirements (e.g., `age:18+` for alcohol). Combined with
 *      the C4 framework, the cart payload then carries
 *      `eligibility_requirements[]` until the agent submits a verified claim.
 *
 * Per-tenant text overrides via Payload are scheduled for Phase E; the
 * static table here is the cross-tenant baseline.
 */

import type { UcpCart, UcpCartLine, UcpCartWarning } from "./cart-mapper";
import {
	registerEligibilityChecker,
	type EligibilityRequirement,
} from "./eligibility";

/** One disclosure entry — what goes into `warnings[]` plus optional eligibility ties. */
export interface DisclosureEntry {
	type: "age_restriction" | "regulatory_disclosure" | "recycling_notice";
	severity: "low" | "medium" | "high";
	message: string;
	/** Eligibility type strings (`age:18+`, `prescription:valid`) gating purchase. */
	requires_eligibility?: string[];
}

/**
 * Closed table of supported disclosure_type slugs. Adding a category is a
 * deliberate code change so the per-tenant Payload override (Phase E) has
 * something stable to extend on top.
 */
export const DISCLOSURES: Record<string, DisclosureEntry> = {
	alcohol: {
		type: "age_restriction",
		severity: "high",
		message:
			"Tento produkt obsahuje alkohol. Prodej osobám mladším 18 let je zakázán.",
		requires_eligibility: ["age:18+"],
	},
	dietary_supplement: {
		type: "regulatory_disclosure",
		severity: "low",
		message: "Doplněk stravy. Nenahrazuje pestrou stravu.",
	},
	medical_device_class_i: {
		type: "regulatory_disclosure",
		severity: "medium",
		message: "Zdravotnický prostředek třídy I. Před použitím si přečtěte návod.",
	},
	electronics_recycling: {
		type: "recycling_notice",
		severity: "low",
		message: "Recyklační poplatek je zahrnut v ceně. Po skončení životnosti odevzdejte na sběrném místě.",
	},
};

/**
 * Saleor product attribute slug we look at. Exposed as a constant so admin
 * tooling (Payload custom views) can advertise the contract.
 */
export const DISCLOSURE_ATTRIBUTE_SLUG = "disclosure_type";

/** Heterogeneous line-attribute representation (Saleor product attributes shape). */
interface LineWithAttributes {
	id: string;
	variant?: {
		product?: {
			attributes?: Array<{
				attribute: { slug: string };
				values: Array<{ slug: string }>;
			}>;
		};
	};
}

/**
 * Walk a Saleor checkout line and convert its `disclosure_type` attribute
 * values into UCP cart warnings. Returns `[]` when the line has no
 * disclosure markers, or none that match the table.
 */
export function buildLineDisclosures(line: LineWithAttributes): UcpCartWarning[] {
	const slugs = extractDisclosureSlugs(line);
	if (slugs.length === 0) return [];

	const out: UcpCartWarning[] = [];
	for (const slug of slugs) {
		const entry = DISCLOSURES[slug];
		if (!entry) continue;
		out.push({ code: entry.type, message: entry.message, line_id: line.id });
	}
	return out;
}

let disclosureCheckerRegistered = false;

/**
 * Idempotent registration of the cart-wide eligibility checker that turns
 * disclosure-flagged lines into requirements. Safe to call multiple times.
 */
export function registerDisclosureEligibilityChecker(): void {
	if (disclosureCheckerRegistered) return;
	disclosureCheckerRegistered = true;
	registerEligibilityChecker(disclosureChecker);
}

/** Test helper — drop the guard flag so a fresh registry can re-register. */
export function _resetDisclosureRegistration(): void {
	disclosureCheckerRegistered = false;
}

function disclosureChecker(_cart: UcpCart, line?: UcpCartLine): EligibilityRequirement[] {
	if (!line) return [];
	const slugs = extractDisclosureSlugsFromUcpLine(line);
	if (slugs.length === 0) return [];

	const out: EligibilityRequirement[] = [];
	for (const slug of slugs) {
		const entry = DISCLOSURES[slug];
		if (!entry?.requires_eligibility) continue;
		for (const requirement of entry.requires_eligibility) {
			const [type] = requirement.split(":");
			if (!type) continue;
			out.push({
				type,
				applies_to: "line",
				applies_to_id: line.id,
				required: true,
				message: `${entry.message} (requires ${requirement})`,
			});
		}
	}
	return out;
}

function extractDisclosureSlugs(line: LineWithAttributes): string[] {
	const attrs = line.variant?.product?.attributes ?? [];
	const match = attrs.find((a) => a.attribute.slug === DISCLOSURE_ATTRIBUTE_SLUG);
	if (!match) return [];
	return match.values.map((v) => v.slug).filter(Boolean);
}

/**
 * UCP cart lines don't carry attributes natively. The cart mapper stashes the
 * raw attribute list on a private symbol-keyed property; this helper reads it
 * back. If the attribute isn't present (older cart payload), we return [].
 */
const ATTRS_SYMBOL = Symbol.for("ucp.cart.line.disclosure_slugs");

function extractDisclosureSlugsFromUcpLine(line: UcpCartLine): string[] {
	const slugs = (line as unknown as { [k: symbol]: unknown })[ATTRS_SYMBOL];
	return Array.isArray(slugs) ? (slugs as string[]) : [];
}

/**
 * Attach disclosure slugs onto a UCP cart line so the registered eligibility
 * checker can read them later. Used by cart-mapper. The slugs are stored on
 * a `Symbol.for(...)`-keyed property so they don't leak into the serialised
 * JSON response.
 */
export function attachDisclosureSlugs(line: UcpCartLine, slugs: string[]): void {
	(line as unknown as { [k: symbol]: unknown })[ATTRS_SYMBOL] = slugs;
}

/** Same lookup as `extractDisclosureSlugsFromUcpLine`, exposed for unit tests. */
export function getDisclosureSlugs(line: UcpCartLine): string[] {
	return extractDisclosureSlugsFromUcpLine(line);
}
