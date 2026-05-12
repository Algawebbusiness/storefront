/**
 * F1 stub entry — just verifies the Vite single-file bundle pipeline
 * produces a working HTML payload. Real React rendering + AppBridge
 * wiring lands in F2 (theme injection + bridge) and F4 (product list /
 * card components against real Saleor data).
 */

import { createRoot } from "react-dom/client";

function ProductCardStub() {
	return (
		<div style={{ fontFamily: "system-ui, sans-serif", padding: "1rem" }}>
			<strong>MCP Apps product card — F1 stub</strong>
			<p style={{ marginTop: "0.5rem", color: "#555" }}>
				The bundle pipeline works. Real product rendering arrives in F4.
			</p>
		</div>
	);
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<ProductCardStub />);
