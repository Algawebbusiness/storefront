import { describe, expect, it } from "vitest";
import {
	contextToMetadataInput,
	extractContextFromMetadata,
	META_KEY_BUYER_PREFERENCES,
	META_KEY_INTENT,
	META_KEY_SESSION_ID,
	validateContext,
} from "@/lib/protocols/shared/context-mapper";

describe("validateContext", () => {
	it("ok for undefined", () => {
		expect(validateContext(undefined)).toEqual({ ok: true, errors: [] });
	});

	it("ok for empty object", () => {
		expect(validateContext({})).toEqual({ ok: true, errors: [] });
	});

	it("ok for valid intent + buyer_preferences + session_id", () => {
		const result = validateContext({
			intent: "Ethiopian honey-process for v60",
			buyer_preferences: { max_age_days: 14, origin_priority: ["ethiopia"] },
			session_id: "agent-session-123",
		});
		expect(result.ok).toBe(true);
		expect(result.buyerPreferencesJson).toBe(
			'{"max_age_days":14,"origin_priority":["ethiopia"]}',
		);
	});

	it("rejects intent over 500 chars", () => {
		const tooLong = "a".repeat(501);
		const result = validateContext({ intent: tooLong });
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toMatchObject({ field: "intent" });
		expect(result.errors[0]!.message).toContain("501");
	});

	it("accepts intent at exactly 500 chars", () => {
		expect(validateContext({ intent: "a".repeat(500) }).ok).toBe(true);
	});

	it("rejects buyer_preferences that is an array", () => {
		const result = validateContext({
			buyer_preferences: ["not", "an", "object"] as unknown as Record<string, unknown>,
		});
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toMatchObject({ field: "buyer_preferences" });
	});

	it("rejects buyer_preferences whose JSON exceeds 2000 chars", () => {
		const big = { padding: "x".repeat(2100) };
		const result = validateContext({ buyer_preferences: big });
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toMatchObject({ field: "buyer_preferences" });
	});

	it("rejects non-string intent", () => {
		const result = validateContext({ intent: 42 as unknown as string });
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toMatchObject({ field: "intent" });
	});

	it("rejects non-string session_id", () => {
		const result = validateContext({ session_id: 42 as unknown as string });
		expect(result.ok).toBe(false);
		expect(result.errors[0]).toMatchObject({ field: "session_id" });
	});

	it("collects multiple errors at once", () => {
		const result = validateContext({
			intent: "a".repeat(501),
			session_id: 42 as unknown as string,
		});
		expect(result.ok).toBe(false);
		expect(result.errors).toHaveLength(2);
	});
});

describe("contextToMetadataInput", () => {
	it("returns null for undefined context", () => {
		expect(contextToMetadataInput(undefined)).toBeNull();
	});

	it("returns null for empty context (no fields set)", () => {
		expect(contextToMetadataInput({})).toBeNull();
	});

	it("emits intent under metadata key 'intent'", () => {
		expect(contextToMetadataInput({ intent: "buy coffee" })).toEqual([
			{ key: META_KEY_INTENT, value: "buy coffee" },
		]);
	});

	it("emits session_id under metadata key 'agent_session_id'", () => {
		expect(contextToMetadataInput({ session_id: "sess_x" })).toEqual([
			{ key: META_KEY_SESSION_ID, value: "sess_x" },
		]);
	});

	it("uses cached buyerPreferencesJson when provided to avoid double-stringify", () => {
		const cached = '{"x":1}';
		const out = contextToMetadataInput({ buyer_preferences: { x: 1 } }, cached);
		expect(out).toEqual([{ key: META_KEY_BUYER_PREFERENCES, value: cached }]);
	});

	it("falls back to JSON.stringify when no cached JSON is provided", () => {
		const out = contextToMetadataInput({ buyer_preferences: { y: 2 } });
		expect(out).toEqual([{ key: META_KEY_BUYER_PREFERENCES, value: '{"y":2}' }]);
	});

	it("packs all three fields together", () => {
		const out = contextToMetadataInput({
			intent: "i",
			buyer_preferences: { z: 3 },
			session_id: "s",
		});
		expect(out).toEqual([
			{ key: META_KEY_INTENT, value: "i" },
			{ key: META_KEY_BUYER_PREFERENCES, value: '{"z":3}' },
			{ key: META_KEY_SESSION_ID, value: "s" },
		]);
	});
});

describe("extractContextFromMetadata", () => {
	it("returns undefined for empty metadata", () => {
		expect(extractContextFromMetadata([])).toBeUndefined();
		expect(extractContextFromMetadata(null)).toBeUndefined();
		expect(extractContextFromMetadata(undefined)).toBeUndefined();
	});

	it("returns undefined when no UCP keys are present", () => {
		expect(
			extractContextFromMetadata([{ key: "some.other.app.key", value: "hi" }]),
		).toBeUndefined();
	});

	it("extracts intent + session_id + buyer_preferences round-trip", () => {
		const metadata = contextToMetadataInput({
			intent: "buy coffee",
			buyer_preferences: { x: 1, y: "two" },
			session_id: "s_abc",
		})!;
		expect(extractContextFromMetadata(metadata)).toEqual({
			intent: "buy coffee",
			buyer_preferences: { x: 1, y: "two" },
			session_id: "s_abc",
		});
	});

	it("ignores malformed buyer_preferences JSON without throwing", () => {
		const ctx = extractContextFromMetadata([
			{ key: META_KEY_INTENT, value: "i" },
			{ key: META_KEY_BUYER_PREFERENCES, value: "{not valid json" },
		]);
		expect(ctx).toEqual({ intent: "i" });
	});

	it("ignores buyer_preferences that decodes to a non-object (array, primitive)", () => {
		expect(
			extractContextFromMetadata([
				{ key: META_KEY_BUYER_PREFERENCES, value: '"a string"' },
			]),
		).toBeUndefined();

		expect(
			extractContextFromMetadata([{ key: META_KEY_BUYER_PREFERENCES, value: "[1,2]" }]),
		).toBeUndefined();
	});

	it("coexists with unrelated metadata entries", () => {
		expect(
			extractContextFromMetadata([
				{ key: "ucp.intent", value: "leftover from A4" }, // old prefix — ignored now
				{ key: "other.app", value: "x" },
				{ key: META_KEY_INTENT, value: "current" },
			]),
		).toEqual({ intent: "current" });
	});
});
