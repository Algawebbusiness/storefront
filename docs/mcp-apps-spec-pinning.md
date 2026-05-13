# MCP Apps spec pinning (Phase F8)

> Owner: storefront team. Read this before bumping
> `@modelcontextprotocol/ext-apps` or touching the iframe handshake
> path in `src/mcp-apps/src/bridge.ts`.

This document captures **which spec revision we target, how we pin the
client library, and what to do when either drifts**. The MCP Apps spec
is still labelled "draft" in the upstream repo (`specification/draft/apps.mdx`),
so we expect spec churn between F-stack ship and the protocol's first
stable release.

---

## 1. Spec snapshot

| Aspect               | Value                                                    |
| -------------------- | -------------------------------------------------------- |
| Spec revision date   | **2026-01-26**                                           |
| Source               | `modelcontextprotocol/modelcontextprotocol` draft branch |
| Status               | Draft (`specification/draft/apps.mdx`)                   |
| Last storefront sync | 2026-05-13 (Phase F1 introduction)                       |

The implementation lives under `src/mcp-server/apps/` (server) and
`src/mcp-apps/` (client iframe bundle). Every entry that ships in
`src/mcp-apps/views/` is bound to a `ui://saleor/<name>.html` resource
registered through `registerAppResource` (ext-apps server helper).

---

## 2. Pinned versions

| Package                          | Pin       | Why                                                                                 |
| -------------------------------- | --------- | ----------------------------------------------------------------------------------- |
| `@modelcontextprotocol/ext-apps` | `1.7.1`   | First version that ships the paired-tool `visibility` field. Locked exact (no `^`). |
| `@modelcontextprotocol/sdk`      | `^1.29.0` | Peer of ext-apps@1.7.1. Caret is OK — minor SDK bumps are non-breaking.             |

Lockfile: `pnpm-lock.yaml` carries the resolved versions. The exact ext-apps
pin matters because the spec is draft — minor releases can rename
`_meta.ui.*` keys.

---

## 3. Quarterly review process

Every quarter (or when a known-breaking spec note lands in
[`agentic-commerce-2026-plan.md`](../agentic-commerce-2026-plan.md)):

1. **Diff the spec.** `git log specification/draft/apps.mdx` upstream.
   Open issues / PRs labelled `apps:` or `ext-apps:`.
2. **Check the ext-apps changelog.** `pnpm view @modelcontextprotocol/ext-apps versions`.
   Read the release notes for any version newer than our pin.
3. **Smoke test the bump.** In a feature branch:
   - `pnpm add -E @modelcontextprotocol/ext-apps@<new>`.
   - `pnpm exec tsc --noEmit` both configs.
   - `pnpm exec vitest run` — the F8 fallback suite + the apps-meta
     suite together cover the registration shape.
   - `pnpm run build:mcp-apps` and confirm bundle gzip size stays under
     the 250 KB budget (build script flags overruns).
4. **Run the manual host check** (see §5). At minimum: MCP Inspector +
   one non-MCP-Apps JSON-RPC client (curl-driven `tools/call`).
5. **Update the snapshot date** at the top of this doc; merge.

If a breaking spec rev lands, prefer the feature-flag escape (§4) over
trying to support both shapes simultaneously.

---

## 4. Breaking-change escape hatch

`process.env.MCP_APPS_ENABLED=false` (or `0`, `no`, `off`, case-insensitive)
disables the Apps surface across the entire MCP server. Concretely:

- `registerAppTool` (shim in `src/mcp-server/apps/feature-flag.ts`)
  strips `_meta.ui` before forwarding to the raw SDK `server.registerTool`.
  Tools keep working, their schemas stay intact — `tools/list` just no
  longer advertises a UI resource per tool.
- `registerToolPair` skips the `_full` sibling entirely (see
  `src/mcp-server/apps/paired-tools.ts`). Without `_meta.ui.visibility =
["app"]` the sibling would land in `tools/list` and leak PII, so the
  helper degrades to "model only".
- The iframe bundles themselves stay registered as `ui://` resources but
  no tool references them, so a host that ignores the `resources/list`
  output never loads them.
- Tool responses still pass through `wrapAsData` (`src/mcp-server/apps/sanitize.ts`).
  The indirect-prompt-injection defense is independent of the iframe
  surface; even without MCP Apps, the BEGIN/END delimiters keep the
  model framed correctly.

After flipping the flag, deploy is one process restart. No code change
needed. Re-enabling is symmetric.

---

## 5. Manual smoke matrix

When bumping ext-apps OR touching `apps/` server code, run this checklist:

| Host                                       | Pass criterion                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| MCP Inspector (current)                    | Tool calls succeed; iframe renders; no console errors                  |
| MCP Inspector (3+ months old)              | Tool calls succeed; iframe may render plain JSON; no 500s              |
| `curl` against `/mcp` (no `ui/initialize`) | Tool calls return wrapped JSON; no Apps-specific 500s                  |
| Claude Desktop                             | iframe renders + paired-tool `_full` calls round-trip via fetchAppData |

The handshake-timeout fallback (`bridge.ts` 5-second race, see Phase F8)
guarantees the third row: if the host doesn't reply to `ui/initialize`,
the iframe self-renders a `<pre>` JSON dump so the user still sees data.

---

## 6. Known unresolved spec questions

| Question                                                                      | Stance                                                                                                                          | Tracking                 |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Is `ui/message` content shown to the user, or only injected into LLM context? | Conservative: assume LLM-context. Iframe uses typed-enum `sendUiMessage(...)` so wording is server-rendered (threat-model §4).  | Re-check next review     |
| `_meta.ui.permissions` enum values (`tools.unattended`, ...)                  | Not used. Add when spec stabilises and matches a real F-stack need.                                                             | Re-check next review     |
| Backward-compat: hosts older than 2026-01-26 with unknown `_meta` keys        | Resolved — JSON-RPC mandates unknown-key tolerance. Confirmed against MCP Inspector. Feature flag covers any future regression. | Closed                   |
| Per-content-block visibility                                                  | Resolved — doesn't exist; replaced with the paired-tool pattern (F3, `paired-tools.ts`).                                        | Closed (F3 threat-model) |
| CSP shape (`resourceDomains` vs `connectDomains`)                             | Resolved — confirmed against ext-apps types. F2 `apps/csp.ts` builds both from env.                                             | Closed (F2)              |

---

## 7. When the flag exists vs when it doesn't

The feature flag is a build-out tool, not a config-of-the-future. Once
the spec stabilises and Claude Desktop / Copilot / Goose all ship MCP
Apps support in mainstream versions, F9 will:

- Mark `MCP_APPS_ENABLED` as deprecated in `.env.example` (default-on,
  no expected reason to disable).
- Keep the shim — it's our regression escape if a future bump lands on
  prod with an unforeseen host bug.

Until then, treat the flag as a 1-line emergency rollback path. Document
flips in `agentic-commerce-2026-plan.md` `## Stav implementace`.
