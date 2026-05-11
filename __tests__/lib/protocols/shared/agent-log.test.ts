import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildRequestSummary,
	logAgentAction,
	withAgentActivityLog,
	type AgentActivityEntry,
} from "@/lib/protocols/shared/agent-log";

function parseLogLine(line: string): AgentActivityEntry {
	return JSON.parse(line.replace("[agent-log] ", "")) as AgentActivityEntry;
}

describe("buildRequestSummary — PII scrubbing", () => {
	it("returns undefined for empty input", () => {
		expect(buildRequestSummary(undefined)).toBeUndefined();
		expect(buildRequestSummary("")).toBeUndefined();
		expect(buildRequestSummary(null)).toBeUndefined();
	});

	it("scrubs card-number-like digit sequences", () => {
		const out = buildRequestSummary(JSON.stringify({ card: "4111111111111111", n: 1 }));
		expect(out).toContain("***");
		expect(out).not.toContain("4111111111111111");
	});

	it("scrubs email addresses", () => {
		const out = buildRequestSummary(JSON.stringify({ note: "contact me at jane@example.com" }));
		expect(out).toContain("***@***");
		expect(out).not.toContain("jane@example.com");
	});

	it("redacts shipping address fields specifically", () => {
		const body = JSON.stringify({
			street_address: "Václavské náměstí 1",
			postal_code: "11000",
			address_locality: "Praha",
			something_else: "ok",
		});
		const out = buildRequestSummary(body);
		expect(out).toContain('"street_address":"<redacted>"');
		expect(out).toContain('"postal_code":"<redacted>"');
		expect(out).toContain('"address_locality":"<redacted>"');
		expect(out).toContain("something_else");
	});

	it("redacts top-level email key with sentinel", () => {
		const out = buildRequestSummary(JSON.stringify({ email: "buyer@x.cz" }));
		expect(out).toContain('"email":"***@***"');
		expect(out).not.toContain("buyer@x.cz");
	});

	it("caps output at 200 chars", () => {
		const big = JSON.stringify({ field: "x".repeat(500) });
		const out = buildRequestSummary(big);
		expect(out!.length).toBeLessThanOrEqual(200);
	});

	it("falls back to text scrub when body is not valid JSON", () => {
		const out = buildRequestSummary("free text with 4111111111111111 and a@b.cz");
		expect(out).toContain("***");
		expect(out).toContain("***@***");
	});
});

describe("logAgentAction", () => {
	const log = vi.spyOn(console, "log").mockImplementation(() => {});
	const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

	afterEach(() => {
		log.mockClear();
		warn.mockClear();
		vi.unstubAllEnvs();
	});

	it("emits a structured [agent-log] line on console (always, even without Payload)", () => {
		vi.stubEnv("PAYLOAD_API_URL", "");
		logAgentAction({
			agent_id: "openai-test",
			action: "cart.create",
			status: "success",
			status_code: 201,
			duration_ms: 42,
		});
		expect(log).toHaveBeenCalledWith(expect.stringMatching(/^\[agent-log\] /));
		const payload = log.mock.calls[0]![0] as string;
		const parsed = parseLogLine(payload);
		expect(parsed.agent_id).toBe("openai-test");
		expect(parsed.action).toBe("cart.create");
		expect(parsed.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});

describe("withAgentActivityLog — wrapper", () => {
	const log = vi.spyOn(console, "log").mockImplementation(() => {});

	afterEach(() => {
		log.mockClear();
		vi.unstubAllEnvs();
	});

	it("logs duration_ms and infers status='success' for 2xx", async () => {
		vi.stubEnv("PAYLOAD_API_URL", "");
		const res = await withAgentActivityLog(
			{ agent_id: "a", action: "cart.create" },
			async () => new Response("{}", { status: 201 }),
		);
		expect(res.status).toBe(201);
		const lastCall = log.mock.calls.at(-1)![0] as string;
		const parsed = parseLogLine(lastCall);
		expect(parsed.status).toBe("success");
		expect(parsed.status_code).toBe(201);
		expect(parsed.duration_ms).toBeGreaterThanOrEqual(0);
	});

	it("infers status='denied' for 401/403/429", async () => {
		vi.stubEnv("PAYLOAD_API_URL", "");
		await withAgentActivityLog(
			{ agent_id: "a", action: "cart.create" },
			async () => new Response("forbidden", { status: 403 }),
		);
		const parsed = parseLogLine(log.mock.calls.at(-1)![0] as string);
		expect(parsed.status).toBe("denied");
	});

	it("infers status='error' for other 4xx/5xx", async () => {
		vi.stubEnv("PAYLOAD_API_URL", "");
		await withAgentActivityLog(
			{ agent_id: "a", action: "cart.create" },
			async () => new Response("bad", { status: 400 }),
		);
		const parsed = parseLogLine(log.mock.calls.at(-1)![0] as string);
		expect(parsed.status).toBe("error");
	});

	it("logs status='error' and rethrows when handler throws", async () => {
		vi.stubEnv("PAYLOAD_API_URL", "");
		await expect(
			withAgentActivityLog({ agent_id: "a", action: "x" }, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		const parsed = parseLogLine(log.mock.calls.at(-1)![0] as string);
		expect(parsed.status).toBe("error");
		expect(parsed.status_code).toBe(500);
	});
});
