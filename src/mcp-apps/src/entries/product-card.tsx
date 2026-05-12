/**
 * F1/F2 stub entry — pipeline smoke test. Real product card rendering
 * lands in F4 against live Saleor data.
 */

import { mountStub } from "./stub";

mountStub({
	label: "MCP Apps product card",
	hint: "The bundle pipeline + theme injection works. Real product rendering arrives in F4.",
});
