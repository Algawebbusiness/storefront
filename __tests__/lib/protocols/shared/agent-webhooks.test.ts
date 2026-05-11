/**
 * Unit tests for notifyAgent (Phase C3).
 *
 * Stubs `fetch` and uses a no-op sleep so retries run instantly. Verifies:
 *   - happy path: one attempt, signed headers, audit log.
 *   - retry until success.
 *   - exhaustion after max_attempts.
 *   - error capture from thrown fetch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { notifyAgent } from "@/lib/protocols/shared/agent-webhooks";

const fetchSpy = vi.spyOn(globalThis, "fetch");

describe("notifyAgent", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		fetchSpy.mockReset();
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
	});

	afterEach(() => {
		logSpy.mockRestore();
	});

	const event = {
		type: "return.refunded",
		resource_type: "return" as const,
		resource_id: "ret_x",
		agent_id: "agent_a",
		payload: { status: "refunded" },
	};

	it("delivers on the first attempt with signed headers", async () => {
		fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));

		const out = await notifyAgent("https://agent.example/hook", event, {
			sleepMs: async () => {},
		});

		expect(out.delivered).toBe(true);
		expect(out.attempts).toBe(1);
		expect(fetchSpy).toHaveBeenCalledOnce();
		const call = fetchSpy.mock.calls[0]!;
		const init = call[1] as RequestInit;
		const headers = init.headers as Record<string, string>;
		expect(headers["UCP-Event-Type"]).toBe("return.refunded");
		expect(headers["UCP-Signature"]).toMatch(/^keyid=".+",alg="ed25519",sig=".+"$/);
		expect(init.method).toBe("POST");

		// Audit log line emitted
		const auditLine = logSpy.mock.calls.find(
			(c: unknown[]) => typeof c[0] === "string" && (c[0] as string).startsWith("[agent-log] "),
		);
		expect(auditLine, "expected an [agent-log] line").toBeDefined();
	});

	it("retries on failure and succeeds on a later attempt", async () => {
		fetchSpy
			.mockResolvedValueOnce(new Response(null, { status: 503 }))
			.mockResolvedValueOnce(new Response(null, { status: 500 }))
			.mockResolvedValueOnce(new Response(null, { status: 200 }));

		const out = await notifyAgent("https://agent.example/hook", event, {
			sleepMs: async () => {},
		});

		expect(out.delivered).toBe(true);
		expect(out.attempts).toBe(3);
		expect(fetchSpy).toHaveBeenCalledTimes(3);
	});

	it("gives up after max_attempts and reports the last error", async () => {
		fetchSpy.mockResolvedValue(new Response(null, { status: 502 }));

		const out = await notifyAgent("https://agent.example/hook", event, {
			max_attempts: 3,
			sleepMs: async () => {},
		});

		expect(out.delivered).toBe(false);
		expect(out.attempts).toBe(3);
		expect(out.last_status).toBe(502);
		expect(out.last_error).toMatch(/HTTP 502/);
	});

	it("captures thrown fetch errors and keeps retrying", async () => {
		fetchSpy
			.mockRejectedValueOnce(new Error("ECONNRESET"))
			.mockResolvedValueOnce(new Response(null, { status: 200 }));

		const out = await notifyAgent("https://agent.example/hook", event, {
			sleepMs: async () => {},
		});

		expect(out.delivered).toBe(true);
		expect(out.attempts).toBe(2);
	});
});
