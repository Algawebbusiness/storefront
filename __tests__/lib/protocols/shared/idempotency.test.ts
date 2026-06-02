import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireLock, releaseLock } from "@/lib/protocols/shared/idempotency";
import { _resetStore } from "@/lib/store";

describe("idempotency lock (CWE-367)", () => {
	beforeEach(() => _resetStore());
	afterEach(() => _resetStore());

	it("a second acquire of the same key fails until released", async () => {
		expect(await acquireLock("checkout-complete:co_1")).toBe(true);
		// Concurrent / duplicate attempt is rejected.
		expect(await acquireLock("checkout-complete:co_1")).toBe(false);
		// After release, the key is free again (retry path).
		await releaseLock("checkout-complete:co_1");
		expect(await acquireLock("checkout-complete:co_1")).toBe(true);
	});

	it("locks are independent per key", async () => {
		expect(await acquireLock("order-return:ord_1")).toBe(true);
		expect(await acquireLock("order-return:ord_2")).toBe(true);
	});
});
