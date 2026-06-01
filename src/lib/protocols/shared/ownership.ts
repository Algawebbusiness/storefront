/**
 * Object-level authorization helpers (IDOR / BOLA defense, CWE-639).
 *
 * Resources are fetched from Saleor by opaque ID through a client that runs at
 * app/anonymous trust level, so "knows the ID" must NOT equal "may access it".
 * These helpers assert that the authenticated principal actually owns the
 * resource before a handler returns or mutates it.
 */

import type { UcpRouteAuth } from "./route-handler";

/** Normalize an email for comparison (lowercase + trim). */
function normEmail(email: string | null | undefined): string | null {
	if (!email) return null;
	const trimmed = email.trim().toLowerCase();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * True when the OAuth-scoped customer in `auth` owns `order`.
 *
 * Ownership = the order's `userEmail` matches the customer's verified OAuth
 * email. Requires a customer context: agent-only (signed / legacy bearer)
 * tokens carry no customer identity, so they never "own" a customer order and
 * this returns false (callers should 403/404 those).
 */
export function ownsOrder(
	order: { userEmail: string | null },
	auth: Pick<UcpRouteAuth, "userContext">,
): boolean {
	const customerEmail = normEmail(auth.userContext?.email);
	if (!customerEmail) return false;
	const ownerEmail = normEmail(order.userEmail);
	if (!ownerEmail) return false;
	return ownerEmail === customerEmail;
}
