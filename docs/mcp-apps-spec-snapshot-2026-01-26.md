# MCP Apps spec — snapshot 2026-01-26

> Provenance file referenced by [`mcp-apps-spec-pinning.md`](./mcp-apps-spec-pinning.md).
> Captures the state of the draft spec on the date we pinned
> `@modelcontextprotocol/ext-apps@1.7.1` and shipped Phase F.

This document is a deliberate freeze. Do not edit it when the upstream
spec changes — instead, log the diff under §3 here, bump the snapshot
file (`mcp-apps-spec-snapshot-YYYY-MM-DD.md`), and update the pin in
the spec-pinning doc.

---

## 1. Spec source

- Path: `specification/draft/apps.mdx` in
  `https://github.com/modelcontextprotocol/modelcontextprotocol` (draft
  branch as of 2026-01-26).
- Mirror reference SDK: `@modelcontextprotocol/ext-apps@1.7.1`
  (first version shipping `_meta.ui.visibility` typed).

The MCP Apps surface adds two pieces to ordinary MCP:

1. A new `ui://` resource scheme served via the existing
   `resources/list` + `resources/read` methods. MIME type
   `text/html;profile=mcp-app`. Each resource entry carries
   `_meta.ui` (CSP allowlist, optional permissions).
2. `_meta.ui` on tools. Specifically `_meta.ui.resourceUri` (which view
   to render for this tool's result) and `_meta.ui.visibility` (an
   array of `"model" | "app"`, defaults to both, omitting either side
   hides the tool from `tools/list` or makes it un-renderable).

Tool results are pushed into the iframe through a host-managed
`ui/notifications/tool-result`. Iframe → server calls go through
`tools/call` relayed by the host; iframe → chat messages through
`ui/message` (typed-enum in this codebase, see `ui-messages.ts`).

---

## 2. What was confirmed during F2/F3 implementation

These were unresolved when Phase F started; they're now closed against
the 2026-01-26 reference SDK:

| Topic                                       | Resolution                                                                                                              |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| CSP shape                                   | `_meta.ui.csp = { resourceDomains, connectDomains }`. Confirmed against ext-apps types.                                 |
| Per-content-block visibility                | Does **not** exist in the spec. Replaced in this codebase by the paired-tool pattern (model + `_full` app sibling).     |
| Unknown `_meta.*` keys on tool definitions  | JSON-RPC mandates tolerance — confirmed against MCP Inspector. The F8 feature flag covers any future regression.        |
| `ui/initialize` handshake handshake-timeout | Spec doesn't mandate a host timeout, so the F8 5-second client-side race + JSON-dump fallback is our own guarantee.     |
| Iframe `tools/call` subject preservation    | Spec language is permissive; we adopt the conservative reading — host re-injects agent identity (no api_key in iframe). |

---

## 3. Outstanding questions on the snapshot date

Two questions remained unresolved on 2026-01-26 and we ship F-stack with
conservative defaults:

| Question                                                                  | Conservative default in this codebase                                                                                              |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Is `ui/message` text shown to the user or only injected into LLM context? | Assumed LLM-only. The iframe never controls the natural-language string — server-rendered via the F3 typed-enum `renderUiMessage`. |
| `_meta.ui.permissions` enum values (e.g. `tools.unattended`)              | Not used. Will revisit when the spec stabilises and a concrete F-stack need shows up.                                              |

Both are tracked in §6 of [`mcp-apps-spec-pinning.md`](./mcp-apps-spec-pinning.md)
and re-evaluated each quarterly review.

---

## 4. Implementation evidence

The codepath as of this snapshot consists of nine submodules:

| Module                                | Anchored by                                                        |
| ------------------------------------- | ------------------------------------------------------------------ |
| `src/mcp-server/apps/registry.ts`     | Six `ui://saleor/*.html` entries (F2)                              |
| `src/mcp-server/apps/csp.ts`          | `buildCsp()` over env-driven origins (F2)                          |
| `src/mcp-server/apps/serve-html.ts`   | `loadThemedView()` injecting `brand.css` + `window.__BRAND__` (F2) |
| `src/mcp-server/apps/feature-flag.ts` | `MCP_APPS_ENABLED` + `registerAppTool` shim (F8)                   |
| `src/mcp-server/apps/paired-tools.ts` | `registerToolPair` model + `_full` app sibling (F3)                |
| `src/mcp-server/apps/sanitize.ts`     | `sanitizeForLlm` 12 vectors + `wrapAsData`/`unwrapAsData` (F3)     |
| `src/mcp-server/apps/data-policy.ts`  | 5-class `FIELD_CLASSES` table + wildcard lookup (F3)               |
| `src/mcp-server/apps/telemetry.ts`    | `logAppView()` through Phase B `logAgentAction` (F9)               |
| `src/mcp-apps/src/bridge.ts`          | Client wrapper + 5s handshake-timeout fallback (F2/F3/F8)          |

Tests covering this surface: `__tests__/mcp-apps/{apps-meta,data-policy,paired-tools,sanitize,serve-html,ui-messages,fallback,csp}.test.ts`.

---

## 5. Next review

Per [`mcp-apps-spec-pinning.md`](./mcp-apps-spec-pinning.md) §3 — the
quarterly window puts the next mandatory sync at ~2026-08-13. Run it
sooner if the ext-apps changelog flags any spec-breaking item.
