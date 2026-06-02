import { describe, expect, it } from "vitest";

import { validateOutboundWebhookUrl } from "@/lib/protocols/shared/url-guard";

describe("validateOutboundWebhookUrl", () => {
	it("allows a public https URL", () => {
		expect(validateOutboundWebhookUrl("https://hooks.agent.example/cb").ok).toBe(true);
	});

	it.each([
		["http (not https)", "http://hooks.agent.example/cb"],
		["localhost", "https://localhost/cb"],
		["*.localhost", "https://api.localhost/cb"],
		["*.internal", "https://svc.internal/cb"],
		["GCP metadata host", "https://metadata.google.internal/cb"],
		["loopback IPv4", "https://127.0.0.1/cb"],
		["cloud metadata IPv4", "https://169.254.169.254/latest/meta-data/"],
		["private 10/8", "https://10.0.0.5/cb"],
		["private 172.16/12", "https://172.16.0.1/cb"],
		["private 192.168/16", "https://192.168.1.1/cb"],
		["0.0.0.0/8", "https://0.0.0.0/cb"],
		["decimal IP encoding", "https://2130706433/cb"],
		["hex IP encoding", "https://0x7f000001/cb"],
		["IPv6 loopback", "https://[::1]/cb"],
		["IPv6 unique-local", "https://[fd00::1]/cb"],
		["credentials in URL", "https://user:pass@hooks.agent.example/cb"],
		["garbage", "not a url"],
	])("blocks %s", (_label, url) => {
		expect(validateOutboundWebhookUrl(url).ok).toBe(false);
	});
});
