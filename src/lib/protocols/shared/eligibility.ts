/**
 * Eligibility framework (Phase C4).
 *
 * UCP 2026-04-08 introduces *eligibility claims* — explicit statements about
 * whether the buyer satisfies a per-line or cart-wide requirement (B2B,
 * age, region, license, …). This module is the registration + evaluation
 * surface used by:
 *
 *   - Cart / checkout response mappers, which surface `eligibility_requirements[]`
 *     on the cart payload when something is missing or denied.
 *   - Per-tenant plug-ins (D5 will register a B2B checker against IČO/DIČ;
 *     C5 will register age/disclosure checkers).
 *
 * Design notes:
 *
 *   - **Closed-union claim shape.** `ClaimStatus` and the well-known `type`
 *     strings are typed unions; an open-string `type` is allowed so plug-ins
 *     can register their own categories without modifying this file.
 *   - **Pure functions.** `checkEligibility` is pluggable but contains no
 *     I/O; checkers must do their own data fetching before calling it.
 *   - **Stable ordering.** Requirements come out in registration order so
 *     the agent-facing response is deterministic.
 *
 * The registry is per-process (no Payload backend yet). Plug-ins register
 * at module load (the typical Next.js side-effect import pattern). Tests
 * use `_resetEligibilityCheckers()` to start clean.
 */

import type { UcpCart, UcpCartLine } from "./cart-mapper";

/** Coarse outcome of one claim. */
export type ClaimStatus = "verified" | "claimed" | "denied" | "required";

/**
 * A statement supplied by the agent (or derived from session metadata)
 * that the buyer meets a particular requirement.
 *
 * `type` is open-string: well-known categories ("b2b", "age", "region",
 * "license") get IntelliSense via the `& {}` trick, but plug-ins remain
 * free to mint new categories.
 */
export interface EligibilityClaim {
	type: KnownClaimType | (string & {});
	status: ClaimStatus;
	/**
	 * Structured proof or context — never PII-sensitive on its own;
	 * checkers extract whatever they need.
	 */
	evidence?: Record<string, unknown>;
	/** Human-readable explanation surfaced when status is `denied`. */
	message?: string;
}

export type KnownClaimType = "b2b" | "age" | "region" | "license";

/** What the agent / buyer is being asked to satisfy. */
export interface EligibilityRequirement {
	type: KnownClaimType | (string & {});
	applies_to: "cart" | "line" | "shipping_method";
	applies_to_id?: string;
	required: boolean;
	message: string;
}

/**
 * A plug-in that inspects a cart (and optionally each line) and returns the
 * requirements it imposes. Callers may also receive a `line` argument so a
 * checker can short-circuit when the line is irrelevant.
 *
 * Checkers MUST be pure functions of `(cart, line?)` — no I/O. If you need
 * to load product attributes (e.g. `disclosure_type`), do it ahead of time
 * and stash the result on the cart / line representation before calling
 * `checkEligibility`.
 */
export type EligibilityChecker = (
	cart: UcpCart,
	line?: UcpCartLine,
) => EligibilityRequirement[];

const checkers: EligibilityChecker[] = [];

/**
 * Register a checker. Plug-ins call this at module-load. Returns an
 * unregister handle so tests can install temporary checkers.
 */
export function registerEligibilityChecker(checker: EligibilityChecker): () => void {
	checkers.push(checker);
	return () => {
		const idx = checkers.indexOf(checker);
		if (idx >= 0) checkers.splice(idx, 1);
	};
}

/** Test helper. */
export function _resetEligibilityCheckers(): void {
	checkers.length = 0;
}

/**
 * Evaluate all registered checkers against a cart and a set of claims.
 *
 * Output:
 *   - `allowed` is `true` when every required, unsatisfied requirement is
 *     covered by a `verified` claim of the same `type`. A `claimed` claim
 *     does NOT satisfy the requirement (the merchant hasn't verified it);
 *     `denied` actively blocks even if not strictly required.
 *   - `missing_requirements` lists the requirements that prevented passage,
 *     in registration order. Empty array implies `allowed: true`.
 *
 * Plug-ins return per-line requirements; this function also runs each
 * checker once with `line=undefined` to surface cart-wide rules.
 */
export function checkEligibility(
	cart: UcpCart,
	claims: EligibilityClaim[],
): { allowed: boolean; missing_requirements: EligibilityRequirement[] } {
	const requirements: EligibilityRequirement[] = [];
	const seen = new Set<string>();
	const addUnique = (req: EligibilityRequirement) => {
		const key = `${req.type}|${req.applies_to}|${req.applies_to_id ?? ""}`;
		if (seen.has(key)) return;
		seen.add(key);
		requirements.push(req);
	};

	for (const checker of checkers) {
		for (const req of checker(cart, undefined)) addUnique(req);
		for (const line of cart.lines) {
			for (const req of checker(cart, line)) addUnique(req);
		}
	}

	const verifiedTypes = new Set(
		claims.filter((c) => c.status === "verified").map((c) => c.type),
	);
	const deniedTypes = new Set(
		claims.filter((c) => c.status === "denied").map((c) => c.type),
	);

	const missing = requirements.filter((r) => {
		if (deniedTypes.has(r.type)) return true; // denied → block regardless of `required`
		if (!r.required) return false;
		return !verifiedTypes.has(r.type);
	});

	return { allowed: missing.length === 0, missing_requirements: missing };
}

/** Inspect the current registry size — used by tests to assert isolation. */
export function _registeredCheckerCount(): number {
	return checkers.length;
}
