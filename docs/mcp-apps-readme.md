# MCP Apps — developer guide

> Single source of truth for the MCP Apps surface in this storefront.
> Read this before touching anything under `src/mcp-server/apps/`,
> `src/mcp-apps/`, or wiring a new `_meta.ui.resourceUri` on a tool.
>
> See also: [`mcp-apps-threat-model.md`](./mcp-apps-threat-model.md),
> [`mcp-apps-spec-pinning.md`](./mcp-apps-spec-pinning.md),
> [`../agentic-commerce-2026-plan.md`](../agentic-commerce-2026-plan.md) §§ F1–F9.

---

## 1. What MCP Apps does for us

Most MCP tools return raw JSON. MCP Apps lets a tool _also_ ship a
sandboxed iframe (`ui://<…>.html`) that the host renders next to the
chat surface. The host pushes the tool result into the iframe via
`ui/notifications/tool-result`; the iframe parses it and renders a real
shopping UI — product carousels, cart preview, checkout summary, order
receipt — instead of a JSON dump.

For Algaweb storefronts, the upside is that Claude Desktop, Copilot,
Goose, Postman, and MCPJam all show product images and prices visually
when a customer chats. No frontend code change in Saleor; no widget
embed. Just a different `_meta` field on the tool, and a small bundle
the host serves through the iframe.

Six views ship today (one bundle per view, all themed per tenant via
`brand.css`):

| View                     | Resource URI                        | Driving tool(s)                                   |
| ------------------------ | ----------------------------------- | ------------------------------------------------- |
| Product list / carousel  | `ui://saleor/product-list.html`     | `search_products`, `get_category_products`        |
| Product card             | `ui://saleor/product-card.html`     | (reserved for future single-card hooks)           |
| Product detail / compare | `ui://saleor/product-detail.html`   | `get_product_detail`, `compare_products`          |
| Cart preview             | `ui://saleor/cart-preview.html`     | `create_checkout`, `get_cart`, `update_cart_line` |
| Checkout summary         | `ui://saleor/checkout-summary.html` | `get_checkout`, `update_checkout`                 |
| Order receipt            | `ui://saleor/order-receipt.html`    | `get_order`, `complete_checkout`                  |

---

## 2. Source layout

```
src/mcp-server/apps/             — server side
  registry.ts                    — APP_RESOURCES map
  csp.ts                         — env-driven CSP for sandboxed iframes
  serve-html.ts                  — read bundle + inject brand.css + window.__BRAND__
  index.ts                       — registerAllAppResources(server)
  feature-flag.ts                — MCP_APPS_ENABLED + registerAppTool shim (F8)
  paired-tools.ts                — registerToolPair model+_full helper (F3)
  data-policy.ts                 — 5-class FIELD_CLASSES table
  sanitize.ts                    — sanitizeForLlm / wrapAsData / unwrapAsData
  telemetry.ts                   — logAppView via Phase B logAgentAction
  cart-preview-mapper.ts         — F6 mapper (model + _full variant)
  checkout-summary-mapper.ts     — F7 mapper
  order-receipt-mapper.ts        — F7 mapper

src/mcp-apps/                    — client iframe bundles (isolated Vite)
  vite.config.ts                 — vite-plugin-singlefile per-view
  views/<name>.html              — entry HTML wrappers
  src/
    entries/<name>.tsx           — per-view React mount
    components/                  — shared UI (ProductCard, CartPreview, …)
    bridge.ts                    — App-class wrapper (onResult / callTool / fetchAppData / sendUiMessage)
    ui-messages.ts               — typed-enum UiMessage union (F3)
    theme.ts                     — window.__BRAND__ accessor
    types.ts                     — shared payload types

scripts/build-mcp-apps.mjs       — per-view Vite loop + gzipped bundle report
```

Tool registrations live in `src/mcp-server/tools/*.ts`. They import
`registerAppTool` from `../apps/feature-flag` (the F8 shim) — never
directly from `@modelcontextprotocol/ext-apps/server` — so the
feature-flag fallback is wired in automatically.

---

## 3. Adding a new view

1. Add an entry to `APP_RESOURCES` in `src/mcp-server/apps/registry.ts`
   with a stable key, URI, bundle path, and human-readable name.
2. Drop `src/mcp-apps/views/<name>.html` (copy an existing one, change
   the title + entry path) and `src/mcp-apps/src/entries/<name>.tsx`
   (subscribe to `bridge.onResult`, render a component).
3. If the view exposes any `customer-pii` / `business-confidential`
   fields, register the driving tool through `registerToolPair` —
   model variant returns the public/cart-state slice, the `_full`
   sibling carries the PII (see `paired-tools.ts`).
4. Otherwise register through the `registerAppTool` shim from
   `apps/feature-flag` so the F8 fallback applies.
5. Add `_meta.ui.resourceUri` pointing at the new URI; wrap the response
   text in `wrapAsData(JSON.stringify(payload), "<kind>")`.
6. Add a payload type to `src/mcp-apps/src/types.ts` (shared between
   server mappers and client components).
7. Build: `pnpm run build:mcp-apps`. The hardened budget check (F9)
   fails the build if any bundle goes over 250 KB gzipped; override
   with `MCP_APPS_BUNDLE_BUDGET_KB=<higher>` if intentional.
8. Test: extend `__tests__/mcp-apps/apps-meta.test.ts` with the new
   wiring assertions; add a mapper data-policy test if you introduced
   a new paired tool.

---

## 4. Useful commands

```bash
# Build all six iframe bundles (also runs as prebuild step).
pnpm run build:mcp-apps

# Type-check both configs.
pnpm exec tsc --noEmit
pnpm exec tsc --noEmit -p src/mcp-apps/tsconfig.json

# Run the MCP Apps test sub-suite.
pnpm exec vitest run __tests__/mcp-apps

# Disable the Apps surface entirely (emergency rollback).
MCP_APPS_ENABLED=false pnpm run dev

# Override the per-view bundle budget (default 250 KB gzipped).
MCP_APPS_BUNDLE_BUDGET_KB=300 pnpm run build:mcp-apps
```

---

## 5. Manual smoke checklist (sign-off for F9)

Run this after every host-affecting change (ext-apps bump, bridge
change, new view). Ideally against Claude Desktop; minimum bar is MCP
Inspector + a raw `curl` `tools/call`.

1. `pnpm run build:mcp-apps && pnpm run dev`.
2. Expose the dev server publicly:
   `npx cloudflared tunnel --url http://localhost:3000`.
3. Add the resulting URL to Claude Desktop as a custom MCP connector
   (`/mcp` endpoint).
4. Prompt: _"find Ethiopian coffee"_ → expect the **product list**
   carousel with thumbnails, names, prices.
5. Prompt: _"show me the second one"_ → expect a **product detail**
   swap with media gallery + variant pills + Add-to-cart CTA.
6. Prompt: _"add 1 to cart"_ → expect **cart preview** with line item
   and totals.
7. Prompt: _"checkout"_ → expect **checkout summary** with addresses +
   shipping picker + Confirm & pay. Pay (host-mediated Stripe SPT) →
   expect **order receipt** with the order number.
8. Verify on every view: tenant `siteName` reflected in any visible
   heading; OKLCH brand colors visible (no fallback white-on-white).
9. Check the browser's Network panel inside the iframe: every external
   request lands on a domain present in
   `_meta.ui.csp.resourceDomains` — anything else means the CSP env
   needs an `MCP_APPS_EXTRA_RESOURCE_DOMAINS` entry.

Document any failure in the next `## Stav implementace` line in
`agentic-commerce-2026-plan.md`. The fallback layers from F8 are
specifically there so a partial failure doesn't take the chat surface
down: the wrapped JSON in the chat itself is always the authoritative
payload.

---

## 6. Operational toggles

| Env var                           | Default    | Effect                                                                                 |
| --------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `MCP_APPS_ENABLED`                | `true`     | `false`/`0`/`no`/`off` → strip `_meta.ui`, skip `_full` siblings (emergency rollback). |
| `MCP_APPS_EXTRA_RESOURCE_DOMAINS` | (empty)    | Comma-separated extra origins for iframe img/script CSP.                               |
| `MCP_APPS_EXTRA_CONNECT_DOMAINS`  | (empty)    | Comma-separated extra origins for iframe fetch/XHR CSP.                                |
| `MCP_APPS_BUNDLE_BUDGET_KB`       | `250`      | Override the per-view gzipped bundle budget in `build-mcp-apps.mjs`.                   |
| `NEXT_PUBLIC_SALEOR_API_URL`      | (required) | Origin derived → primary entry in `csp.resourceDomains`.                               |
| `NEXT_PUBLIC_MEDIA_CDN_ORIGIN`    | (optional) | Additional resource origin for separated CDN deployments.                              |

---

## 7. Telemetry

Phase F9 added `logAppView()` in `src/mcp-server/apps/telemetry.ts`.
Every `resources/read` on a `ui://saleor/*` resource fires
`app.view.<resourceKey>` through the existing Phase B
`logAgentAction()` pipeline:

```json
{
	"agent_id": "anonymous",
	"action": "app.view.cartPreview",
	"scope": "catalog.read",
	"status": "success",
	"status_code": 200,
	"duration_ms": 0,
	"created_at": "2026-05-13T08:42:13.214Z"
}
```

Caveat: hosts typically pre-fetch every advertised resource on connect,
so the event stream is noisier than per-user view counts. The
correlation needed to dedupe per-session lives in Phase E's per-tenant
control panel — until then, treat counts as upper bounds.
