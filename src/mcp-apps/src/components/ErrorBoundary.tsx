/**
 * Per-entry React error boundary (Phase F8).
 *
 * Catches render errors inside the iframe, renders a "shopping UI
 * failed — see chat for the raw response" fallback, and fires a
 * `sendUiMessage({kind:"view.error", view, code})` so the host LLM
 * knows the iframe degraded (and can fall back to the wrapped JSON in
 * its existing tool result).
 *
 * Wrapping policy: every F4–F7 entry renders its root inside this
 * boundary. The boundary itself is intentionally tiny — no Tailwind,
 * no router, no Suspense glue. It only deals with the case where a
 * descendant throws during render or in a lifecycle.
 *
 * Acceptance (F8): if the bundle ships with a typo in a payload type
 * that makes `JSON.parse` succeed but the React tree throw on read,
 * users see the fallback string instead of a blank iframe.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import type { UiMessage } from "../ui-messages";

export interface ErrorBoundaryProps {
	/** View identifier reported in `sendUiMessage({kind:"view.error", view})`. */
	view: string;
	/**
	 * Optional bridge handle for posting `view.error` upstream. We accept
	 * just the typed-enum sender (not the full bridge) so the boundary
	 * doesn't take on the rest of the App surface — keeps the dependency
	 * graph small and the unit test surface trivial.
	 */
	sendUiMessage?: (msg: UiMessage) => Promise<void> | void;
	children: ReactNode;
	/**
	 * Override fallback. The default copy matches the F8 acceptance line:
	 * "Failed to load shopping UI — see chat for raw data."
	 */
	fallback?: ReactNode;
}

interface ErrorBoundaryState {
	hasError: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
	state: ErrorBoundaryState = { hasError: false };

	static getDerivedStateFromError(_error: unknown): ErrorBoundaryState {
		return { hasError: true };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		// Surface the failure to the host once. The boundary stays in the
		// error state — we don't want to flap between fallback and crashy
		// re-renders.
		try {
			void this.props.sendUiMessage?.({
				kind: "view.error",
				view: this.props.view,
				code: "render_error",
			});
		} catch {
			// Bridge unavailable / not connected yet — fallback UI is still
			// useful; the host can lean on the wrapped tool-result text.
		}
		// Echoing the error to the iframe console aids local debugging
		// without leaking back into the chat surface.
		console.error(`[mcp-apps:${this.props.view}] render error`, error, info.componentStack);
	}

	render(): ReactNode {
		if (this.state.hasError) {
			return (
				this.props.fallback ?? (
					<div style={{ padding: "1rem", fontSize: "0.875rem", color: "var(--muted-foreground)" }}>
						Failed to load shopping UI — see chat for raw data.
					</div>
				)
			);
		}
		return this.props.children;
	}
}
