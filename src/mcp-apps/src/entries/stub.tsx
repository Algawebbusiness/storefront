/**
 * Shared F2 stub renderer. Each view's entry file imports this and
 * passes its own label, so the Vite single-file build still produces
 * a small per-view bundle but we don't duplicate boilerplate.
 *
 * Real components ship in F4–F7; for F2 we just need 6 working
 * `ui://` resources so the registry + serve-html pipeline is exercised
 * end-to-end.
 */

import { createRoot } from "react-dom/client";

interface StubProps {
	label: string;
	hint: string;
}

function Stub({ label, hint }: StubProps) {
	return (
		<div
			style={{
				fontFamily: "var(--font-sans, system-ui, sans-serif)",
				padding: "1rem",
				color: "var(--color-foreground, #111)",
				background: "var(--color-background, #fff)",
			}}
		>
			<strong>{label} — F2 stub</strong>
			<p style={{ marginTop: "0.5rem", color: "var(--color-muted-foreground, #555)" }}>{hint}</p>
		</div>
	);
}

export function mountStub(props: StubProps): void {
	const root = document.getElementById("root");
	if (root) createRoot(root).render(<Stub {...props} />);
}
