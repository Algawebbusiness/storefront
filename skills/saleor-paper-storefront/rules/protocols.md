# Skill rule: agentic commerce protocols (ACP + UCP)

> **Scope:** anything under `src/lib/protocols/`, `src/app/api/(ucp|acp)/`, `src/app/.well-known/ucp/`, `src/app/api/webhooks/saleor/`, `src/mcp-server/`, or any task touching how AI agents (ChatGPT, Gemini, MCP-compatible) talk to this storefront.
>
> **Status:** UCP `2026-04-08` (Phase A1–A10 complete, May 2026). Active plan in `agentic-commerce-2026-plan.md`.

---

## When this rule applies

Use this rule when:

- adding/modifying any route under `/api/ucp/rest/*`, `/api/acp/*`, `/.well-known/ucp`, `/api/webhooks/saleor`
- changing the UCP profile (capabilities, services, payment handlers, signing keys)
- changing how cart, checkout, order, or catalog data is mapped to/from Saleor
- handling agent-supplied `context` (intent, buyer_preferences, session_id)
- working on signed responses or signature verification

Skip this rule for storefront UI work, Payload integration, or pure Saleor admin operations — those have their own rules.

---

## Architecture in 60 seconds

```
~/code/storefront/src/lib/protocols/
├── shared/                     # used by both ACP and UCP
│   ├── types.ts                # ProtocolMoney, UcpContext, UcpTotals, ...
│   ├── money.ts                # toMinorUnits, normalizeCurrency
│   ├── address.ts              # Saleor ↔ protocol address
│   ├── auth.ts                 # validateAgentApiKey (API key + OAuth2 JWT)
│   ├── response.ts             # signedJsonResponse, signedUnauthorized, signedProtocolDisabled
│   ├── signing.ts              # ed25519 sign/verify, getPublicKeyBase64
│   ├── context-mapper.ts       # validate/serialize/extract UcpContext
│   ├── checkout-queries.ts     # raw Saleor GraphQL strings + types
│   ├── checkout-mapper.ts      # SaleorCheckout → ProtocolCheckout
│   ├── cart-mapper.ts          # SaleorCheckout → UcpCart (cart layer)
│   ├── order-queries.ts        # raw Saleor order GraphQL
│   ├── order-mapper.ts         # SaleorOrder → ProtocolOrder
│   ├── catalog-queries.ts      # search/detail/categories Saleor queries
│   ├── catalog-mapper.ts       # SaleorProduct → UcpCatalogItem
│   └── payment.ts              # Stripe payment processing
├── acp/
│   ├── types.ts                # ACP-specific shapes (legacy ProtocolTotals)
│   └── product-mapper.ts       # ACP product feed mapper
└── ucp/
    ├── types.ts                # UcpProfile, UcpService, UcpPaymentHandler, UcpSigningKey
    ├── capabilities.ts         # CapabilityDef constants + ALL_BUSINESS_CAPABILITIES
    └── profile-builder.ts      # builds /.well-known/ucp profile (async, includes signing_keys)
```

**Routes:**

| Path | Purpose |
|------|---------|
| `GET /.well-known/ucp` | Discovery profile (NOT signed — bootstrap of trust) |
| `POST/GET/PATCH/DELETE /api/ucp/rest/carts[/[id]/lines/[lineId]]` | Cart CRUD (A4) |
| `POST/GET/PATCH/POST(complete\|cancel) /api/ucp/rest/checkout-sessions/[id]` | Checkout flow |
| `GET /api/ucp/rest/orders/[id]` | Order status |
| `GET /api/ucp/rest/catalog/(search\|products/[slug]\|categories)` | Catalog (A5) |
| `POST /api/acp/checkout/[id]/(complete\|update)` | ACP checkout |
| `GET /api/acp/products/feed` | ACP product feed |
| `POST /mcp` | MCP transport (12 tools: 7 read-only + 5 checkout) |
| `POST /api/webhooks/saleor` | ORDER_CREATED → propagate UCP context to order metadata |

---

## Hard rules

### 1. Edge-runtime safety in signing.ts

`src/lib/protocols/shared/signing.ts` MUST NOT import from `node:crypto`. UCP/ACP routes deploy to edge runtimes (Vercel Edge, Cloudflare Workers) where Node crypto is unavailable. Use `globalThis.crypto.subtle` only. The keygen script (`scripts/generate-signing-keys.mjs`) is the only place where `node:crypto` is allowed — it runs on Node.

### 2. Sign every UCP/ACP response — but never `/.well-known/ucp`

Use `signedJsonResponse(data, init?)` from `response.ts` for every success and error path on `/api/ucp/rest/*` and `/api/acp/*`. Do NOT sign `/.well-known/ucp` (cacheable, bootstrap of trust comes from HTTPS), sitemap, llms.txt, or the product feed.

The signature header is `UCP-Signature: keyid="<id>",alg="ed25519",sig="<base64>"`. Agents verify against the public key in `signing_keys[]` of the profile.

### 3. Adding a new capability

Edit `src/lib/protocols/ucp/capabilities.ts`:

```ts
export const SHOPPING_FOO: CapabilityDef = {
    id: "dev.ucp.shopping.foo",
    spec: "foo",
    schema: "schemas/shopping/foo.json",
    extends: SHOPPING_CHECKOUT.id,  // optional
};

export const ALL_BUSINESS_CAPABILITIES: readonly CapabilityDef[] = [
    SHOPPING_CHECKOUT,
    SHOPPING_FULFILLMENT,
    SHOPPING_DISCOUNT,
    SHOPPING_CART,
    SHOPPING_CATALOG,
    SHOPPING_FOO,  // ← new
];
```

Profile-builder picks it up automatically. Don't touch `profile-builder.ts` — the iteration is centralised.

### 4. Saleor metadata key naming for agent context

Per Phase A7 plan, agent context lives under bare keys (no `ucp.` prefix):

- `intent` — free-form string, max 500 chars
- `buyer_preferences` — JSON-stringified, max 2000 chars after stringify
- `agent_session_id` — opaque string

Use the helpers in `context-mapper.ts` (`validateContext`, `contextToMetadataInput`, `extractContextFromMetadata`) — never read/write these keys directly.

### 5. Totals contract per UCP 2026-04-08

`UcpTotals` is the canonical totals shape: top-level `currency` (ISO 4217 uppercase) + flat `*_cents` integer fields. Emit it from order/checkout mappers. ACP keeps the legacy nested `ProtocolTotals` — its spec line is independent.

For the order top-level `currency` field too, not just inside `totals` — UCP 2026-04-08 mandates both.

### 6. Money: always pass through `toMinorUnits`

Saleor returns decimal amounts. `toMinorUnits({amount, currency})` converts to integer cents and uppercase-normalizes the currency. Never multiply by 100 inline — JPY/KRW are zero-decimal, KWD/BHD are three-decimal.

### 7. Don't expose admin Saleor mutations through MCP or the protocols layer

The protocols layer is for buying. Anything that mutates products, channels, staff, vouchers, etc. must NOT be reachable via `/api/ucp/*`, `/api/acp/*`, or any MCP tool. Use `executeAuthenticatedGraphQL` with `SALEOR_APP_TOKEN` server-side only, behind admin-scoped routes.

### 8. Use `saleorQuery` from `@/mcp-server/saleor-client` for protocol routes

The protocols layer uses raw GraphQL strings (no codegen) to stay independent from the storefront's typed query layer. The pattern:

```ts
const result = await saleorQuery<MyResponseData>(MY_QUERY, { id, ... });
if (!result.ok) {
    return signedJsonResponse(
        { error: { code: "server_error", message: result.error } },
        { status: 500 },
    );
}
```

---

## Adding a new UCP REST endpoint — checklist

1. Add the route file under `src/app/api/ucp/rest/<path>/route.ts`.
2. Guard with `if (process.env.UCP_ENABLED !== "true") return signedProtocolDisabled("UCP");`
3. Validate auth: `const auth = validateAgentApiKey(request); if (!auth.valid) return signedUnauthorized();`
4. Parse body via `request.text()` + `JSON.parse` (or `request.json()` for required-body endpoints) with try/catch → 400.
5. If accepting `context`, run `validateContext(body.context)` and 400 on `errors`.
6. Call Saleor via `saleorQuery<T>(QUERY, vars)`.
7. Map Saleor → protocol shape via the appropriate `*-mapper.ts`.
8. Build UCP meta: `const ucpMeta = await buildUcpMeta(auth.profileUrl);`
9. Return `signedJsonResponse({ ucp: ucpMeta, ...payload }, { status: ... });`
10. For cacheable read endpoints add `export const revalidate = 300;` at the top of the file.
11. Add unit tests for the mapper (pure function — easy). Integration tests against live Saleor are manual via curl (see plan Cross-cutting).

---

## Common gotchas

- **Edge runtime warning:** if you see `node:crypto` errors at build/deploy, you've leaked a Node-only import into an edge route. Hunt down the import chain.
- **Signature length is always 88:** ed25519 signatures are 64 bytes → base64 → 88 chars (with padding). Tests assert this directly.
- **Saleor pagination is cursor-based.** UCP catalog search uses `cursor` + returns `next_cursor`/`has_next_page`. Don't try to emulate `page=N`.
- **`POST /api/ucp/rest/checkout-sessions` and `POST /api/ucp/rest/carts` both wrap the same Saleor `Checkout` object.** Cart layer is leaner (no addresses, no delivery method, sku per line, mandatory currency); checkout-session is the full flow up to `complete`. Don't merge them.
- **Webhook intent propagation needs `SALEOR_APP_TOKEN`.** Without it the propagation silently logs+skips. The order is otherwise unaffected.

---

## Testing

`__tests__/lib/protocols/` mirrors `src/lib/protocols/`. Mappers are pure functions — fast, deterministic. Run subset:

```bash
pnpm exec vitest run __tests__/lib/protocols
```

End-to-end against a live Saleor sandbox is manual — see `agentic-commerce-2026-plan.md` Cross-cutting section.
