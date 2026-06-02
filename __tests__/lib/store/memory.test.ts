import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryKvStore } from "@/lib/store";

describe("InMemoryKvStore", () => {
	afterEach(() => vi.useRealTimers());

	it("set/get and del", async () => {
		const s = new InMemoryKvStore();
		await s.set("k", "v");
		expect(await s.get("k")).toBe("v");
		await s.del("k");
		expect(await s.get("k")).toBeNull();
	});

	it("getdel is single-use", async () => {
		const s = new InMemoryKvStore();
		await s.set("k", "v");
		expect(await s.getdel("k")).toBe("v");
		expect(await s.getdel("k")).toBeNull();
	});

	it("expires values after the TTL", async () => {
		vi.useFakeTimers();
		const now = Date.now();
		vi.setSystemTime(now);
		const s = new InMemoryKvStore();
		await s.set("k", "v", 10);
		vi.setSystemTime(now + 9_000);
		expect(await s.get("k")).toBe("v");
		vi.setSystemTime(now + 11_000);
		expect(await s.get("k")).toBeNull();
	});

	it("incr / incrby", async () => {
		const s = new InMemoryKvStore();
		expect(await s.incr("c")).toBe(1);
		expect(await s.incr("c")).toBe(2);
		expect(await s.incrby("c", 5)).toBe(7);
	});

	it("set membership", async () => {
		const s = new InMemoryKvStore();
		await s.sadd("set", "a");
		await s.sadd("set", "a");
		await s.sadd("set", "b");
		expect(await s.sismember("set", "a")).toBe(true);
		expect(await s.sismember("set", "c")).toBe(false);
		expect(await s.scard("set")).toBe(2);
	});
});
