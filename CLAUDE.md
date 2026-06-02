# CLAUDE.md — Algaweb E-commerce Platform

> **Active implementation plan:** [`agentic-commerce-2026-plan.md`](./agentic-commerce-2026-plan.md) — 5-phase upgrade na **UCP `2026-04-08`** + Stripe Sessions 2026 (50 kroků).
>
> **Stav implementace (květen 2026):**
>
> - **Fáze A (A1–A10): ✅ COMPLETE** — UCP 2026-04-08 parita, ed25519 signed responses, cart/catalog/context/totals/payment-instruments capabilities.
> - **Fáze B (B1–B10): ✅ COMPLETE** — Agent identity & trust layer (registry + signed requests + activity log + per-agent caps + approval flow + OAuth identity binding + accepted_platforms publishing + 180-day migration timeline + abuse detection). 296/296 tests pass.
> - **Fáze B route adoption: ✅ COMPLETE** — 12 UCP REST routes přepsány na `withUcpRoute()` (kombinuje `verifyAgentRequest` + `hasScope` + `checkLimits` + `withAgentActivityLog`). `POST /checkout-sessions/[id]/complete` enforcuje per-session spending cap _před_ Saleor mutací i Stripe nabitím. 315/315 tests pass (+19 nových).
> - **Fáze C (C1–C10): ✅ COMPLETE** — Returns capability + Saleor refund wiring + webhook ORDER_REFUNDED + agent-webhook delivery (retry+sign) + eligibility framework + disclosure contracts + payment-handler registry + Stripe Link / stablecoin / MPP handlers + loyalty capability. 394/394 tests pass.
> - **Fáze F (F1–F9): ✅ COMPLETE** — full agent-shopping flow uvnitř MCP-Apps-aware hostů + paired-tool PII isolation + three-layer fallback + telemetry + docs:
>   - **F1 ✅** — Vite single-file build pipeline (`src/mcp-apps/`), `@modelcontextprotocol/ext-apps@1.7.1` dep + SDK bump na `^1.29`. 6 view bundles ~59 KB gzip každý.
>   - **F2 ✅** — Resource server (`registerAllAppResources()`), CSP allowlist z env, tenant theme injection (`brand.css` + `window.__BRAND__`), klient bridge wrapping `App` třídu.
>   - **F3 ✅** — Paired-tool PII isolation + prompt-injection defense. `data-policy.ts` (5-class FIELD_CLASSES + helpers), `paired-tools.ts` (`registerToolPair` ↔ `_full` app-only sibling), `sanitize.ts` (`sanitizeForLlm` 12 vektorů + `wrapAsData` delimiter), `ui-messages.ts` typed-enum + `bridge.ts` `sendUiMessage` + `fetchAppData`. Threat model `docs/mcp-apps-threat-model.md`. 455/455 tests pass.
>   - **F4 ✅** — Catalog tools wired to `ui://saleor/product-list.html`. `search_products` + `get_category_products` migrated to `registerAppTool` s `_meta.ui.resourceUri`; `get_collections` deferred (separate collection view později). No paired-tool — catalog je `public` třída. Tool responses zalité `wrapAsData(..., "product-list")`. React komponenty `ProductCard` + `ProductList` (responsive grid, var(--token) theming, no Tailwind). Bridge `onResult` automaticky unwrap-uje BEGIN/END delimiter před `JSON.parse`. Bundles gz: product-list 136.2 KB, product-card 136.0 KB. 468/468 tests pass.
>   - **F5 ✅** — Product detail view (`get_product_detail` + `compare_products`) sdílí `ui://saleor/product-detail.html` přes discriminated `ProductDetailPayload` (`mode: "single" | "compare"`). No paired-tool — payload stays in `public` class (no custom-tier / B2B confidential fields on this surface). Server-side: `parseEditorJSToText` → `sanitizeForLlm` → `wrapAsData(..., "product-detail")` na description. Nové komponenty `MediaGallery` (thumb strip), `VariantSelector` (OOS variants visible+disabled), `AttributeTable`, `ProductDetail` (single = gallery+info+CTA; compare = 2–5 column grid). Add-to-cart click přepošle `create_checkout` přes bridge BEZ `api_key` — host preserves agent identity; F6 doplní iframe-relay handling na checkout-tools. Bundle: product-detail 137.4 KB gz (< 220 KB target). 474/474 tests pass; commit 3f2598cb.
>   - **F6 ✅** — First paired-tool surface. `get_cart` (paired model) + `get_cart_full` (paired app, `visibility:["app"]`, hidden) sdílí `ui://saleor/cart-preview.html`; iframe pulls PII via `bridge.fetchAppData("get_cart", {checkout_id})`. Standalone app-only `update_cart_line` handles qty steppers (`quantity:0` → delete, `>0` → update). `create_checkout` + `get_checkout` migrated to `registerAppTool` with cart-preview view; both return `CartPreviewPayload` (no PII), `wrapAsData(..., "cart-preview")`. `api_key` optional through the group — iframe-relayed calls omit it, HTTP agents may still pass. New mapper split (`mapCheckoutToCartPreview` model + `…Full` for app). Komponenty `CartLine` + `TotalsBlock` + `CartPreview` (Proceed CTA gated on `hasEmail && hasShippingAddress`; fires `sendUiMessage({kind:"cart.proceed_to_checkout"})` — first F3 typed-enum consumed). Bundle: cart-preview 137.6 KB gz. 482/482 tests pass; commit f9392161.
>   - **F7 ✅** — Checkout summary + order receipt views. `get_checkout` re-homed → paired (model+full v `tools/checkout-summary.ts`); NEW paired `get_order` + `get_order_full` (`tools/order-receipt.ts`). `update_checkout` + `complete_checkout` → `registerAppTool` s `visibility:["app"]` (hidden from `tools/list`, iframe-only). Po platbě `complete_checkout` natáhne novou order přes ORDER_BY_ID_QUERY → reálná 7-field receipt. Allow-listed key sety: checkout summary = 9 klíčů, order receipt = 7. Nové komponenty `AddressBlock`, `ShippingPicker`, `CheckoutSummary` (Confirm CTA fires `sendUiMessage({kind:"checkout.confirm_requested"})` — payment_token nikdy v iframe), `OrderReceipt`. Bundles gz: checkout-summary 138.5 KB, order-receipt 137.9 KB. 492/492 tests pass; commit e1cea6d4.
>   - **F8 ✅** — Three fallback layers. `MCP_APPS_ENABLED` env flag (default ON; `false`/`0`/`no`/`off` disable, case-insensitive); flag-aware `registerAppTool` shim strips `_meta.ui`, `registerToolPair` skips `_full` sibling entirely when off. `ErrorBoundary` wraps all six entries; on render error fires `sendUiMessage({kind:"view.error", view, code:"render_error"})` (F3 `view.error` typed-enum finally konzumovaný). `bridge.ts` 5s `HANDSHAKE_TIMEOUT_MS` race against `app.connect()` — on timeout iframe rewrites `document.body` to `<pre>` JSON dump (escapes `<`). Nový `docs/mcp-apps-spec-pinning.md` (7 sekcí: snapshot 2026-01-26, pinned versions, quarterly review, escape hatch, smoke matrix, unresolved questions, deprecation plan). 501/501 tests pass; commit 5e956af7.
>   - **F9 ✅** — Phase F closure. `src/mcp-server/apps/telemetry.ts` (`logAppView` přes Phase B `logAgentAction`); `apps/index.ts` volá při každém `resources/read`. Hard bundle budget v build scriptu (>250 KB gz → exit 1; `MCP_APPS_BUNDLE_BUDGET_KB=<n>` overrides). `csp.test.ts` (8 cases) env-permutation coverage. Čtyři nové docs: `docs/mcp-apps-readme.md` (developer guide + 9-step manual smoke), `docs/mcp-apps-spec-snapshot-2026-01-26.md` (provenance freeze), `docs/announcements/2026-mcp-apps-launch.md` (Czech 1-pager pro klienty), plus `AGENTS.md` + `MIGRATION.md` updates. 509/509 tests pass; commit 189637b8.
> - **Fáze D: čeká.** Czech moat (Comgate, GoPay, Zásilkovna jako UCP fulfillment, ARES IČO/DIČ). D a F jsou nezávislé.
>
> Před implementační prací načti relevantní krok z `agentic-commerce-2026-plan.md`.
>
> **Původní PRD:** [`saleor-agent-first-prd.md`](./saleor-agent-first-prd.md) — UCP `2026-01-23` baseline + sekce 10 (deltový update na 2026-04-08).
>
> **Migrace AGENT_API_KEYS pro klienty:** [`MIGRATION.md`](./MIGRATION.md) — 180-day dual-mode timeline.
>
> **Workspace:** `~/code/storefront/` (mimo Nextcloud, kvůli sync race s `.git/`). Viz `~/Nextcloud/vibecode-migration/STATUS.md`.

## Route migration plan (fáze B → routes)

> Cíl: přejít 12 UCP REST routes z legacy `validateAgentApiKey` (sync) na nový `verifyAgentRequest` (async) + obalit handlery `withAgentActivityLog` + propustit `checkLimits` před každou mutující operací. Žádné nové features — adopce už hotových building blocků z B3, B4, B5.

### Co se mění v každé route

| Před                                                                 | Po                                                                                                                     |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `import { validateAgentApiKey } from "@/lib/protocols/shared/auth";` | `import { verifyAgentRequest } from "@/lib/protocols/shared/auth";`                                                    |
| `const auth = validateAgentApiKey(request);`                         | `const verify = await verifyAgentRequest(request);`                                                                    |
| `if (!auth.valid) return signedUnauthorized();`                      | `if (!verify.ok) return signedUnauthorized(verify.reason);`                                                            |
| `auth.profileUrl` → `buildUcpMeta(...)`                              | `verify.profileUrl` → `buildUcpMeta(...)`                                                                              |
| `await request.json()` / `await request.text()`                      | `JSON.parse(verify.bodyText)` (body už byl konzumován middleware)                                                      |
| Mutující route bez limit checku                                      | Před mutací: `await checkLimits(verify.agent, amountCents?, sessionId?)` → 429 pokud blocked                           |
| Handler return                                                       | Obal celého handleru `withAgentActivityLog({ agent_id, action, scope, resource_id, amount_cents }, async () => {...})` |

### Routes v scope (12)

| #   | Route                                                | Action label                      | Scope guard         | Amount track                        |
| --- | ---------------------------------------------------- | --------------------------------- | ------------------- | ----------------------------------- |
| 1   | `POST /api/ucp/rest/carts`                           | `cart.create`                     | `cart.create`       | —                                   |
| 2   | `GET /api/ucp/rest/carts/[id]`                       | `cart.read`                       | `cart.create`       | —                                   |
| 3   | `PATCH /api/ucp/rest/carts/[id]`                     | `cart.update`                     | `cart.update`       | —                                   |
| 4   | `DELETE /api/ucp/rest/carts/[id]`                    | `cart.cancel`                     | `cart.update`       | —                                   |
| 5   | `POST /api/ucp/rest/carts/[id]/lines`                | `cart.add_line`                   | `cart.update`       | cart total after add                |
| 6   | `PATCH /api/ucp/rest/carts/[id]/lines/[lineId]`      | `cart.update_line`                | `cart.update`       | cart total after update             |
| 7   | `DELETE /api/ucp/rest/carts/[id]/lines/[lineId]`     | `cart.remove_line`                | `cart.update`       | —                                   |
| 8   | `POST /api/ucp/rest/checkout-sessions`               | `checkout.create`                 | `checkout.create`   | —                                   |
| 9   | `GET/PATCH /api/ucp/rest/checkout-sessions/[id]`     | `checkout.read`/`checkout.update` | `checkout.create`   | —                                   |
| 10  | `POST /api/ucp/rest/checkout-sessions/[id]/complete` | `checkout.complete`               | `checkout.complete` | **cart total → spending cap check** |
| 11  | `POST /api/ucp/rest/checkout-sessions/[id]/cancel`   | `checkout.cancel`                 | `checkout.create`   | —                                   |
| 12  | `GET /api/ucp/rest/orders/[id]`                      | `order.read`                      | `order.read`        | —                                   |

Plus: `GET /api/ucp/rest/approvals/[id]` (B6, čerstvě přidaný) zůstává s `validateAgentApiKey` — je to read-only polling endpoint, agent identity tady stačí v základním tvaru.

ACP routes (`/api/acp/*`) **nejsou v scope** této migrace — ACP má vlastní version cadence (2026-01-30), agent identity layer pro ACP je samostatný projekt (Phase E).

Catalog routes (`/api/ucp/rest/catalog/*`) jsou GET-only, scope `catalog.read`, žádné amount, žádné limity nad rate. Migrace je cosmetická (změna `validateAgentApiKey` → `verifyAgentRequest`) ale stále hodnotná pro audit log.

### Strategie

1. **Helper soubor** `src/lib/protocols/shared/route-handler.ts` (nový): `withUcpRoute({ action, scope, computeAmount? }, handler)` — kombinuje `verifyAgentRequest` + `hasScope` guard + `checkLimits` + `withAgentActivityLog`. Routes pak deklarativně použijí jeden wrapper místo 4 helperů.
2. **Migrace per-route** s sed pattern kde je shoda + targeted Edit kde není.
3. **Test coverage:** existujícím route mappers přidat 1 integration-style test per route group (cart, checkout-sessions, orders) přes `Request` → handler → `Response`. Drží se mimo live Saleor — mockují `saleorQuery`.
4. **Backwards compat:** legacy bearer (přes `verifyAgentRequest` fallback) stále funguje, jen logguje deprecation. To je B9 dual-mode chování.

### Acceptance po migraci

- [ ] 12 UCP routes nepoužívají `validateAgentApiKey` (grep returns 0).
- [ ] Každá mutující route obalena `withAgentActivityLog`.
- [ ] `POST /checkout-sessions/[id]/complete` volá `checkLimits` s cart totalem.
- [ ] Routes vrací 403 s `verify.reason` když agent nemá scope (nový kód, dosud nereachable).
- [ ] Existující 296 testů pass + nové route handler tests.
- [ ] Legacy bearer + `AGENT_API_KEYS` flow stále funguje (B9 timeline).

Změna je čistě infrastructure adopce. Žádný nový feature surface, žádná breaking změna pro agenty kteří už používají signed requests.

## Kdo jsem a co děláme

Jsem Jirka, provozuji **Algaweb** — českou webovou agenturu a managed hosting providera. Stavím e-shopy pro klienty na **Saleor** (headless e-commerce backend) s **Next.js** frontendem. Kóduji primárně přes AI (vibecoding). Komunikuji česky, ale technické dokumenty a kód píšu anglicky.

## Prodejní kanály — co tato šablona umožňuje

Šablona pokrývá **10 prodejních kanálů** z jednoho deploye, jednoho Saleor backendu.

### Lidské kanály (browser)

| Kanál              | Popis                                                           | Implementace                                                                        |
| ------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Webový eshop**   | Klasický storefront — katalog, košík, checkout, zákaznický účet | Next.js App Router, Server Components, ISR caching                                  |
| **Mobilní web**    | Responzivní design, mobile-first, PWA-ready                     | Tailwind CSS, touch-optimized UI                                                    |
| **Google Search**  | Rich results v Google — ceny, dostupnost, hodnocení             | 5 JSON-LD builderů (Product, BreadcrumbList, Organization, WebSite, CollectionPage) |
| **Sociální sítě**  | Náhledové karty při sdílení (Facebook, Twitter, LinkedIn)       | OpenGraph + Twitter Card metadata na všech stránkách                                |
| **SEO / Crawlery** | Kompletní indexace pro vyhledávače                              | robots.txt, sitemap.xml (dynamický), canonical URLs                                 |

### AI agentové kanály (programatické)

| Kanál                   | Popis                                                                 | Implementace                                                                     |
| ----------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **ChatGPT (ACP)**       | Zákazník řekne "kup mi tohle" → ChatGPT provede checkout a platbu     | ACP product feed + checkout REST API + Stripe payment tokens                     |
| **Google Gemini (UCP)** | Zákazník hledá v Google AI Mode → Gemini objeví eshop a dokončí nákup | `/.well-known/ucp` profil + REST checkout + MCP binding + capability negotiation |
| **Libovolný MCP agent** | Jakýkoli MCP-kompatibilní agent (Claude, Cursor, custom boty)         | 12 MCP tools (7 read-only + 5 checkout)                                          |
| **LLM crawlery**        | Perplexity, SearchGPT a další AI vyhledávače rozumí eshopu            | `/llms.txt` manifest s popisem obchodu a odkazy na data                          |
| **Strojové feedy**      | Cenové srovnávače, agregátory, partnerské systémy                     | `/api/products/feed.json` — kompletní produktový feed                            |

### Autentizační modely

| Model                           | Použití                                                      | Implementace                                     |
| ------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| **Guest checkout**              | Zákazník bez účtu — browser i AI agent                       | Saleor anonymous checkout                        |
| **Zákaznický účet**             | Login, uložené adresy, historie objednávek                   | Saleor JWT auth + cookie session                 |
| **OAuth2 (agent za zákazníka)** | AI agent propojí zákaznický účet → nakupuje s jeho daty      | OAuth2 Authorization Code + PKCE, token rotation |
| **API klíč (agent-level)**      | Platformy (OpenAI, Google) se autentizují partnerským klíčem | Bearer token z AGENT_API_KEYS env var            |

### Proč je to důležité

Většina eshopových šablon pokrývá jen **2 kanály** (web + mobil). Tato šablona pokrývá **10 kanálů** z jednoho codebase. Agentic commerce (ACP, UCP, MCP) je v roce 2026 v začátcích — mít to jako template-ready řešení je konkurenční výhoda pro Algaweb i pro klienty.

---

## Vize: "Algaweb Portal"

Budujeme platformu, kde klient spravuje celý svůj online byznys z **jednoho místa** — ideálně z jednoho chatovacího okna. Na pozadí běží více systémů, ale klient o nich neví a nepotřebuje vědět. Konkrétně:

- Klient **NEVÍ** o Saleoru (white-label, nikdy nevidí Saleor Dashboard ani branding)
- Klient **NEMUSÍ VĚDĚT** o Payloadu (vidí ho jako "svůj portál" s vlastním brandingem)
- Klient má **JEDNO přihlášení** a **JEDNO rozhraní** na vše (produkty, objednávky, blogy, stránky, média)
- Cíl je minimalizovat počet UI aplikací, které klient musí ovládat — ideálně vše přes AI chat

---

## Architektura platformy

### Source of Truth pravidla (NEPORUŠOVAT)

| Data                                    | Source of Truth | Důvod                                |
| --------------------------------------- | --------------- | ------------------------------------ |
| Produkty, varianty, ceny, sklad         | **Saleor**      | Commerce engine, kalkulace, validace |
| Objednávky, checkout, platby            | **Saleor**      | Transakční integrita                 |
| Zákazníci, košík                        | **Saleor**      | Session management, auth             |
| Slevy, vouchery, promotion rules        | **Saleor**      | Business logika                      |
| Blogy, stránky, landing pages           | **Payload CMS** | Content management                   |
| Navigační menu, bannery                 | **Payload CMS** | Vizuální obsah                       |
| Média a obrázky (content)               | **Payload CMS** | Asset management                     |
| SEO metadata (content stránky)          | **Payload CMS** | Content-driven SEO                   |
| Product enrichment (delší popisy, tipy) | **Payload CMS** | Rozšířený obsah nad rámec Saleoru    |
| Klientský admin přístup                 | **Payload CMS** | Unified login, multi-tenant          |

### Systémové schéma

```
┌─────────────────────────────────────────────────────────────┐
│                     KLIENT VIDÍ                              │
│                                                              │
│   ┌──────────────┐    ┌──────────────────────────────────┐  │
│   │  AI Chat      │    │  Algaweb Portal (Payload Admin)  │  │
│   │  (OpenClaw)   │    │  white-labeled per tenant         │  │
│   │               │    │                                    │  │
│   │  "Přidej      │    │  Produkty │ Objednávky │ Blogy   │  │
│   │   produkt..." │    │  Stránky  │ Média      │ SEO     │  │
│   └──────┬───────┘    └──────────┬───────────────────────┘  │
│          │                        │                          │
└──────────┼────────────────────────┼──────────────────────────┘
           │                        │
     ┌─────▼────────────────────────▼─────┐
     │         MCP Server Layer            │
     │  (Saleor MCP + Payload MCP + n8n)   │
     └─────┬──────────────────┬────────────┘
           │                  │
    ┌──────▼──────┐   ┌──────▼──────┐
    │   SALEOR     │   │  PAYLOAD    │
    │  (commerce)  │◄──│  (content)  │
    │              │   │             │
    │  Products    │   │  Blogs      │
    │  Orders      │   │  Pages      │
    │  Checkout    │   │  Media      │
    │  Payments    │   │  Navigation │
    │  Customers   │   │  Enrichment │
    └──────────────┘   └─────────────┘
    1 instance,         1 instance,
    N channels          N tenants
    (1 per client)      (1 per client)
```

### Multi-tenancy model

| Systém         | Izolace                        | Mechanismus                                            |
| -------------- | ------------------------------ | ------------------------------------------------------ |
| **Saleor**     | 1 channel = 1 klient           | Permission groups s `restrictedAccessToChannels: true` |
| **Payload**    | 1 tenant = 1 klient            | Oficiální `@payloadcms/plugin-multi-tenant`            |
| **Storefront** | 1 deployment = 1 klient        | Paper fork s channel-scoped routing                    |
| **AI Chat**    | 1 OpenClaw instance = 1 klient | MCP servery scoped per tenant                          |

**PRAVIDLO:** Produkty v Saleoru VŽDY patří jen do jednoho channelu. Nikdy nesdílej produkty mezi klienty/channely.

---

## Technologický stack (NEMĚNIT bez konzultace)

| Vrstva               | Technologie                              | Poznámka                                         |
| -------------------- | ---------------------------------------- | ------------------------------------------------ |
| **Commerce engine**  | Saleor (self-hosted)                     | GraphQL API, JEDINÝ source of truth pro commerce |
| **CMS**              | Payload CMS (self-hosted, PostgreSQL)    | Multi-tenant, white-labeled admin panel          |
| **Storefront**       | Next.js 16 + App Router (Paper template) | Server Components, React 19                      |
| **Jazyk**            | TypeScript (strict mode)                 | Povinné, žádné `any` v produkci                  |
| **Styling**          | Tailwind CSS + CSS custom properties     | Design tokeny v `src/styles/brand.css`           |
| **UI komponenty**    | shadcn/ui + Paper e-commerce komponenty  | shadcn jako primitiva                            |
| **GraphQL**          | GraphQL Codegen + TypedDocumentString    | NEPOUŽÍVAT starý `@saleor/sdk`                   |
| **Hosting frontend** | Cloudflare Pages nebo Vercel             | Statické + edge rendering                        |
| **Hosting backend**  | Self-hosted (Cloudron/Docker)            | Saleor + Payload na Algaweb infra                |
| **Platby**           | Saleor payment apps (Stripe, Adyen)      | Integrace přes checkout flow                     |
| **AI Chat**          | OpenClaw + MCP servery                   | Saleor MCP + Payload MCP + n8n MCP               |
| **Package manager**  | pnpm                                     | Vyžadován Paper templatem                        |

---

## Payload CMS — Content & Admin Layer

### Proč Payload

- Next.js nativní (běží ve stejném ekosystému jako storefront)
- Plně customizovatelný React admin panel (white-labeling)
- Oficiální multi-tenant plugin
- PostgreSQL adapter (stejná DB technologie jako Saleor)
- Hooks systém pro integraci s externími API
- REST + GraphQL + Local API automaticky generované

### Payload vlastní (VŽDY source of truth)

- Blogy a články
- Statické stránky (O nás, Kontakt, Obchodní podmínky)
- Landing pages a bannery
- Navigační menu
- Média a obrázky (content)
- Product enrichment — rozšířené popisy, tipy, návody (nad rámec Saleor product description)
- SEO metadata pro content stránky

### Payload ZOBRAZUJE ale NEVLASTNÍ (data čte ze Saleor API)

- Produkty, ceny, varianty, sklad → read přes Saleor GraphQL API
- Objednávky a jejich stav → read přes Saleor GraphQL API
- Zákazníci → read přes Saleor GraphQL API
- Slevy a vouchery → read přes Saleor GraphQL API

### Commerce operace v Payload Admin panelu

Klient edituje produkty, ceny, slevy přímo v Payload portálu. Implementace:

1. **Custom React views** v Payload Admin, které volají Saleor GraphQL API
2. Klient nevidí Saleor Dashboard — vidí custom UI v Payloadu
3. `afterChange` hooky v Payloadu propagují změny do Saleoru tam, kde Payload je source of truth (enrichment)
4. Pro commerce data (ceny, sklad) jde o přímé Saleor GraphQL mutations volané z Payload custom views

### Saleor → Payload synchronizace

Saleor CMS App (oficiální) synchronizuje produkty jednosměrně ze Saleoru do Payloadu:

- `PRODUCT_CREATED` → vytvoří záznam v Payload
- `PRODUCT_UPDATED` → aktualizuje záznam
- `PRODUCT_DELETED` → smaže záznam

Tato sync slouží pro: vyhledávání, relace s blogy, SEO enrichment. NIKOLIV jako primární data store.

### Payload multi-tenancy setup

```
payload.config.ts:
  plugins: [
    multiTenantPlugin({
      // Každý tenant = 1 klient
      // Tenant field automaticky přidán do všech kolekcí
      // Admini vidí jen svá data
    })
  ]

Collections:
  - Tenants (klienti)
  - Users (per-tenant admini)
  - Pages (statické stránky)
  - Posts (blog články)
  - Media (obrázky, soubory)
  - Navigation (menu)
  - ProductEnrichment (rozšířené popisy, napojené na Saleor product ID)
```

### Payload white-labeling

- Custom `admin.css` — barvy, logo per tenant
- Odstranit veškeré Payload branding
- Custom login stránka
- Tenant-specific dashboard views

### Storefront ↔ Payload integrace (✅ IMPLEMENTOVÁNO)

Storefront má vestavěnou podporu pro Payload CMS. Stačí nastavit `PAYLOAD_API_URL` v `.env` a obsah se automaticky zobrazí. Bez Payloadu vše funguje jako dřív (graceful degradation).

**Knihovna (`src/lib/payload/`):**

- `client.ts` — REST API client s cachováním (1h content, 5min navigace) a graceful fallback
- `types.ts` — TypeScript typy pro všechny Payload collections (Post, Page, ProductEnrichment, Navigation)
- `queries.ts` — Query helpers: `getPublishedPosts()`, `getPostBySlug()`, `getPageBySlug()`, `getProductEnrichment()`, `getNavigation()`

**Stránky:**
| Route | Zdroj dat | Popis |
|-------|-----------|-------|
| `/[channel]/blog` | Payload `posts` | Blog listing s paginací |
| `/[channel]/blog/[slug]` | Payload `posts` | Blog detail s RichText rendererem |
| `/[channel]/pages/[slug]` | Payload `pages` → Saleor fallback | Statické stránky (Payload má přednost) |
| `/[channel]/products/[slug]` | Saleor + Payload `product-enrichment` | PDP s obohaceným obsahem (tipy, návody) |

**RichText renderer** (`src/ui/components/payload-rich-text.tsx`):
Renderuje Payload 3.x Lexical editor output — headings, paragraphs, lists, links, images, code, blockquotes. Tailwind prose styling.

**Env variables:**

```env
PAYLOAD_API_URL=https://cms.example.com/api   # Payload REST API
PAYLOAD_API_KEY=                                # Payload API key
```

**PRAVIDLO:** Saleor je VŽDY source of truth pro commerce data. Payload je source of truth pro content (blogy, stránky, enrichment). NIKDY nefetchuj sekvenčně — vždy `Promise.all`.

---

## Storefront — Paper Template

### Klíčové strategické rozhodnutí

**Nestavíme od nuly.** Jako základ používáme oficiální **Saleor "Paper" Storefront** (`github.com/saleor/storefront`). Paper je production-ready šablona, která řeší většinu e-commerce problémů out of the box.

### Struktura projektu

```
src/
├── app/                    # Next.js App Router
│   ├── [channel]/          # Channel-scoped routes (multi-channel)
│   └── checkout/           # Checkout pages
├── checkout/               # Checkout komponenty a logika
├── graphql/                # GraphQL queries (tady přidáváme nové)
├── gql/                    # Generované typy (NEEDITOVAT ručně!)
├── ui/components/          # UI komponenty
│   ├── account/            # Zákaznický profil, adresář
│   ├── pdp/                # Product Detail Page
│   ├── plp/                # Product Listing Page
│   ├── cart/               # Košík (drawer)
│   └── ui/                 # Primitiva (Button, Badge, atd.)
└── styles/brand.css        # Design tokeny — SEM jdou barvy klienta
```

### Co Paper již řeší (NEIMPLEMENTOVAT znovu)

- **Checkout** — multi-step, guest + auth, mezinárodní formuláře, connection resilience
- **Košík** — slide-over drawer, real-time updates, editace množství
- **Product detail** — multi-attribute variant selection, dynamic pricing, image gallery
- **Product listing** — category & collection stránky s paginací
- **Zákaznický účet** — profil, adresář, historie objednávek, změna hesla, smazání účtu
- **Auth** — login, registrace, reset hesla, guest checkout
- **SEO** — metadata, JSON-LD, Open Graph
- **Caching** — ISR s on-demand revalidací přes webhooky
- **Multi-channel** — channel-scoped routing
- **API resilience** — automatic retries, rate limiting, timeouts

### Caching model

```
Product Pages (cached 5 min) → Cart (always live) → Checkout (always live) → Payment (always live)
```

- Display stránky jsou cachované pro výkon
- Košík a checkout VŽDY volají API přímo (`cache: "no-cache"`)
- Saleor je source of truth — ceny validuje server-side
- Webhook revalidace pro okamžité updates

### Storefront + Payload integrace

Storefront fetchuje data z OBOU systémů paralelně:

```typescript
// SPRÁVNĚ — paralelní fetch, nikdy waterfall
const [product, enrichment] = await Promise.all([
	saleorClient.query(ProductBySlugDocument, { slug }),
	payloadClient.find({
		collection: "product-enrichment",
		where: { saleorProductId: { equals: productId } },
	}),
]);
```

**PRAVIDLO:** NIKDY nefetchuj Payload a Saleor sekvenčně. Vždy `Promise.all`.

**Caching rozdíl:**

- Saleor data: cached 5 min, revalidated přes webhooky
- Payload content: cached agresivně (hodiny/dny), content se mění zřídka

### GraphQL pravidla

1. **NEPOUŽÍVEJ `@saleor/sdk`** — je deprecated. Používáme přímé GraphQL volání
2. Queries definuj v `src/graphql/` složce
3. Po přidání/úpravě query spusť `pnpm run generate`
4. Generované typy v `src/gql/` NIKDY needituj ručně
5. Používej `TypedDocumentString` pattern z Paper
6. Pro checkout queries: `pnpm run generate:checkout`

---

## AI Chat Layer — OpenClaw

### Vize

Klient má jedno chatovací okno (OpenClaw instance), ze kterého ovládá celý svůj byznys. Nemusí vědět, kolik systémů běží na pozadí.

### Příklady interakcí

```
Klient: "Přidej nový produkt — Věnec jarní, cena 450 Kč, kategorie Věnce"
→ AI: Saleor mutation productCreate + Payload enrichment record
→ AI: "Hotovo, produkt je na eshopu. Chceš k němu napsat blogpost?"

Klient: "Kolik mám objednávek tento týden?"
→ AI: Saleor query orders + filtr
→ AI: "Tento týden 12 objednávek za celkem 8 400 Kč."

Klient: "Změň cenu na Růže červená na 89 Kč"
→ AI: Saleor mutation productVariantUpdate
→ AI: "Cena změněna. Starý: 99 Kč → Nový: 89 Kč."

Klient: "Napiš blogpost o jarní údržbě zahrady"
→ AI: Payload API create post
→ AI: "Blogpost vytvořen jako draft. Chceš ho publikovat?"
```

### MCP Server architektura

| MCP Server  | Systém                   | Operace                                |
| ----------- | ------------------------ | -------------------------------------- |
| Saleor MCP  | Saleor GraphQL API       | Produkty, objednávky, zákazníci, slevy |
| Payload MCP | Payload REST/GraphQL API | Blogy, stránky, média, enrichment      |
| n8n MCP     | n8n workflows            | Komplexní operace napříč systémy       |

**PRAVIDLO:** AI chat NIKDY nepřistupuje přímo k databázi. Vždy přes MCP servery s tenant-scoped API tokeny.

### Graduated autonomy pro AI

| Úroveň           | Akce                 | Příklad                             |
| ---------------- | -------------------- | ----------------------------------- |
| Auto-execute     | Read-only dotazy     | "Kolik mám objednávek?"             |
| Execute + notify | Nízko-rizikové změny | "Změň popis produktu"               |
| Draft + approve  | Střední riziko       | "Vytvoř nový produkt za 450 Kč"     |
| Escalate         | Vysoké riziko        | "Smaž všechny produkty v kategorii" |

---

## Algaweb customizace

### 1. Branding storefrontu (VŽDY první krok u nového klienta)

Edituj `src/styles/brand.css`:

- Barvy (OKLCH color system, CSS custom properties)
- Fonty
- Spacing a border-radius

**Princip:** Změna několika řádků v `brand.css` změní celý look & feel.

### 2. České specifika (Algaweb přidaná hodnota)

Toto Paper neřeší a musíme dodat:

- **Česká fakturace** — IČ, DIČ pole v checkout/profilu
- **Platební brány** — GoPay, Comgate (pokud klient nechce Stripe)
- **Dopravci** — Zásilkovna (Packeta), PPL, Česká pošta, Balíkovna
- **DPH logika** — české sazby, reverse charge pro B2B
- **Lokalizace** — české překlady UI textů

### 3. Specifické e-shop features podle klienta

- Produktové filtry (Paper je plánuje)
- Wishlist / oblíbené
- Hodnocení produktů
- Newsletter signup (Listmonk integrace)

---

## Jak pracuji a jak mi pomáhat

### Workflow

1. Popisuji, co chci — často hlasem přes Whisper → `human.md`
2. AI implementuje v Claude Code
3. Iteruji na výsledku

### Jak psát kód pro mě

- **TypeScript strict** — žádné `any`, žádné `// @ts-ignore`
- **Server Components default** — `'use client'` jen když je to nezbytné
- **Tailwind pro styling** — žádné CSS moduly, žádné styled-components
- **shadcn/ui pro primitiva** — Button, Dialog, Sheet, Select, atd.
- **Error handling** — vždy ošetři loading/error stavy
- **Accessibility** — semantic HTML, ARIA labels, keyboard navigation
- **Mobilní first** — responzivní design od mobilu nahoru

### Čemu se vyhnout

- NEPOUŽÍVEJ `@saleor/sdk` — je deprecated
- NEIMPLEMENTUJ vlastní auth systém — Saleor JWT flow je v Paper
- NEPIŠ vlastní checkout logiku — Paper checkout je otestovaný
- NEMĚŇ strukturu `src/gql/` ručně — vždy generuj přes codegen
- NEPŘIDÁVEJ nové dependencies bez zdůvodnění
- NEPOUŽÍVEJ `pages/` router — pouze App Router
- NEFETCHUJ Payload a Saleor sekvenčně — vždy Promise.all
- NEUKLÁDEJ commerce data do Payloadu — Saleor je source of truth
- NEDÁVEJ klientovi přístup do Saleor Dashboard

---

## Paper AI Skills

Paper obsahuje **15 task-specific rules** v `skills/saleor-paper-storefront/rules/`:

- GraphQL best practices
- Data caching
- Variant selection
- Checkout flow
- **czech-localization** — next-intl setup, překlady, Server vs Client patterns
- **czech-checkout** — IČO/DIČ business fields, validace, metadata storage
- **czech-shipping** — Zásilkovna/Packeta widget, pickup point flow
- **brand-customization** — per-client branding (brand.ts, globals.css, logo)
- a další

**VŽDY si přečti relevantní skill před implementací!**

Dále existuje `AGENTS.md` v rootu repozitáře — architektonický přehled pro AI agenty.

---

## Saleor instance (testovací)

- **API URL:** `https://saleor-core.sliplane.app/graphql/`
- **Channel:** `default-channel` (ověřit přes Saleor Dashboard)
- **Hosting:** Sliplane (Docker)
- **GraphQL codegen:** ✅ Funguje — `pnpm run generate:all` generuje typy z API

---

## Prostředí a příkazy

```bash
# Paper Storefront setup
git clone https://github.com/saleor/storefront.git
cd storefront
cp .env.example .env
pnpm install

# Development
pnpm dev                    # Dev server na localhost:3000
pnpm build                  # Produkční build
pnpm run generate           # Regenerace GraphQL typů (storefront)
pnpm run generate:checkout  # Regenerace GraphQL typů (checkout)

# Storefront env variables (.env) — viz .env.example
NEXT_PUBLIC_SALEOR_API_URL=https://[instance].saleor.cloud/graphql/  # POVINNÉ
NEXT_PUBLIC_DEFAULT_CHANNEL=default-channel                          # POVINNÉ
NEXT_PUBLIC_STOREFRONT_URL=http://localhost:3000                     # Pro canonical URLs a OG images
SALEOR_APP_TOKEN=             # Volitelné — enables multi-channel builds

# Zatím NEPOUŽÍVANÉ (pro budoucí Payload integraci):
# SALEOR_WEBHOOK_SECRET=      # Webhook HMAC verifikace
# PAYLOAD_API_URL=            # Payload REST API endpoint
# PAYLOAD_API_KEY=            # Payload auth token
# NEXT_PUBLIC_ZASILKOVNA_API_KEY=  # Zásilkovna widget

# Payload CMS setup
npx create-payload-app@latest
# Zvolit PostgreSQL adapter
# Nainstalovat @payloadcms/plugin-multi-tenant
```

---

## Licence

- **Paper Storefront:** FSL-1.1-ALv2 — můžeme používat, modifikovat, deployovat pro klienty. NESMÍME nabízet jako managed storefront SaaS. Konvertuje na Apache 2.0 po 2 letech.
- **Payload CMS:** MIT — plně open-source, bez omezení.
- **Saleor:** BSD-3 — plně open-source.

---

## Algaweb infrastruktura

- **Saleor backend** — self-hosted na Sliplane (migrace na vlastní mini PC datacenter)
- **Payload CMS** — self-hosted (Cloudron/Docker), PostgreSQL
- **Monitoring** — Uptime Kuma + Grafana + Prometheus
- **Chyby** — Sentry → n8n → Linear (auto-tickets)
- **Automatizace** — n8n pro workflow automatizaci
- **Fakturace** — Invoice Ninja
- **CRM** — Notion (interní, 7 databází)

---

## Roadmapa: Jak přistupovat k novému e-shop projektu

### Fáze 1: Storefront šablona ✅ HOTOVO

1. ~~Fork Paper → env variables pro klientův Saleor channel~~
2. ~~`brand.css` → barvy, fonty, vizuální identita klienta~~
3. ~~České moduly → IČO/DIČ, Zásilkovna~~
4. ~~SEO → JSON-LD, sitemap, robots, llms.txt~~
5. ~~i18n → next-intl, 20+ komponent cs/en~~
6. ~~Agentic commerce → ACP, UCP, MCP, OAuth2~~
7. ~~Payload CMS integrace → blog, stránky, product enrichment~~
8. ~~128 testů, 0 TS errors~~

### Fáze 2: Payload backend (PŘÍŠTÍ KROK — separátní projekt)

1. Setup Payload s PostgreSQL a multi-tenant pluginem
2. Collections: Pages, Posts, Media, Navigation, ProductEnrichment
3. Saleor CMS App pro jednosměrnou sync produktů
4. White-label Payload admin panel

### Fáze 3: Unified Portal (po ověření Payload)

1. Custom React views v Payloadu pro Saleor commerce data
2. Klient spravuje vše z jednoho admin panelu
3. Klient nikdy nevidí Saleor Dashboard

### Fáze 4: AI Chat (po stabilním portálu)

1. OpenClaw instance per klient
2. MCP servery: Saleor + Payload + n8n
3. Chat pro jednoduché operace

### Fáze 5: Scale + doplňkové feedy

1. Google Merchant Center XML feed
2. Heureka.cz, Zboží.cz XML feedy
3. Facebook Catalog feed
4. Comgate/GoPay platební brány
5. PPL, Česká pošta, Balíkovna
6. POS systém (Point of Sale)

---

## Implementované české features (stav: duben 2026)

### 1. Lokalizace (next-intl) — INTEGROVÁNO

**Stav:** next-intl v4.8.3 je plně integrován do Next.js pipeline. Zbývá postupná migrace UI komponent na překlady.

**Infrastruktura (✅ hotovo):**

```
next.config.js              — createNextIntlPlugin wrapper
src/i18n/config.ts          — Locale type ['cs', 'en'], default 'cs'
src/i18n/request.ts         — getRequestConfig() s cookie-based detection
src/app/layout.tsx           — async, getLocale() pro dynamický <html lang>
src/middleware.ts            — Sets NEXT_LOCALE cookie (Accept-Language detection)
src/config/locale.ts        — Locale mapa cs/en s getLocaleConfig(), default cs-CZ
src/messages/cs.json        — ~360 řádků českých překladů
src/messages/en.json        — ~360 řádků anglických překladů
src/ui/components/locale-switcher.tsx — CZ/EN přepínač
```

**Migrované komponenty (10+):**

- `footer.tsx` — `getTranslations("footer")`
- `nav/search-bar.tsx` — `getTranslations("search")`
- `nav/mobile-menu.tsx` — `useTranslations("nav")`
- `cart/cart-drawer.tsx` — `useTranslations("cart")` (15+ strings)
- `pdp/add-to-cart.tsx` — `useTranslations("cart")` + `useTranslations("checkout")`
- `pagination.tsx` — `useTranslations("pagination")`
- `auth/login-mode.tsx` — `useTranslations("auth")` (20+ strings)
- `sign-up-form.tsx` — `useTranslations("auth")` (25+ strings)
- `checkout/shipping/zasilkovna-widget.tsx` — `useTranslations("checkout")`
- `checkout/address-form/czech-business-fields.tsx` — `useTranslations("checkout")`
- `locale-switcher.tsx` — `useLocale()`

**Další migrované komponenty:**

- `account/account-nav.tsx` — `useTranslations("nav")` (nav labels, back to store, sign out)
- `account/change-password-form.tsx` — `useTranslations("account"/"auth"/"common")`
- `account/page.tsx` — `getTranslations("account"/"common")` (welcome, orders, address)
- `search/page.tsx` — `getTranslations("search")` (results, empty state)
- `products/page.tsx` — `getTranslations("product")` (breadcrumbs, hero)
- `cart/page.tsx` — `getTranslations("cart")` (empty state, totals)

**Co zbývá (nižší priorita):**

- [ ] PLP filter-bar (complex, lots of sort/filter labels)
- [ ] Account: edit-name-form, delete-account-section
- [ ] Product card labels (minimal text)

**Pattern pro Server Components:**

```tsx
import { getTranslations } from "next-intl/server";
const t = await getTranslations("namespace");
```

**Pattern pro Client Components:**

```tsx
import { useTranslations } from "next-intl";
const t = useTranslations("namespace");
```

### 2. IČO/DIČ (checkout metadata)

```
src/checkout/components/address-form/czech-business-fields.tsx — IČO/DIČ pole
src/checkout/lib/validators/czech.ts — validace (modulo 11, formát)
```

- Zobrazí se když `countryCode === "CZ"` AND `companyName` je vyplněno
- Uloženo v checkout metadata (klíče: `ico`, `dic`)
- Zobrazeno v address display a order confirmation

### 3. Zásilkovna (Packeta widget)

```
src/config/shipping.ts — konfigurace, detekce metody
src/checkout/components/shipping/zasilkovna-widget.tsx — widget
```

- Detekce: `/zásilkovna|packeta/i` na jménu shipping metody
- Widget z CDN: `https://widget.packeta.com/v6/www/js/library.js`
- Env var: `NEXT_PUBLIC_ZASILKOVNA_API_KEY`
- Metadata klíče: `zasilkovna_point_id`, `zasilkovna_point_name`, `zasilkovna_point_address`

### 4. Co ještě chybí

- [ ] Comgate platební brána (separátní Saleor Payment App)
- [ ] Comgate redirect handling v checkout payment stepu
- [ ] GraphQL codegen (spustit `pnpm run generate:checkout` po nastavení SALEOR_API_URL)
- [ ] GoPay platební brána
- [ ] PPL, Česká pošta, Balíkovna (pickup point widgety)

---

## SEO & Agent-First vrstva (stav: duben 2026)

Implementováno podle PRD v `saleor-agent-first-prd.md`. Všechny změny jsou aditivní — žádný existující kód nebyl nahrazen.

### 1. Technické SEO

```
src/app/robots.ts           — robots.txt (disallow checkout/cart/account/api/login/orders)
src/app/sitemap.ts          — Dynamický sitemap.xml (všechny produkty, kategorie, kolekce, stránky)
```

- Sitemap fetchuje data přímo ze Saleor API (lightweight queries, bez codegen závislosti)
- Produkty jsou stránkované (100/stránka), ostatní entity jednorázový fetch
- Výchozí channel z `NEXT_PUBLIC_DEFAULT_CHANNEL`

### 2. JSON-LD Structured Data

```
src/lib/seo/json-ld.ts      — buildProductJsonLd() + jsonLdScriptProps() helper
src/lib/seo/index.ts         — Re-exporty builderů
```

**Dostupné buildery (5):**
| Builder | Schema.org typ | Použito na |
|---------|---------------|------------|
| `buildProductJsonLd()` | Product (s Offer/AggregateOffer) | Produktová stránka |
| `buildBreadcrumbListJsonLd()` | BreadcrumbList | Produkt, kategorie, kolekce |
| `buildOrganizationJsonLd()` | Organization | Homepage |
| `buildWebSiteJsonLd(channel)` | WebSite + SearchAction | Homepage |
| `buildCollectionPageJsonLd()` | CollectionPage + ItemList | Připraveno pro kategorie, kolekce |

**Pattern pro použití:**

```tsx
import { buildProductJsonLd, jsonLdScriptProps } from "@/lib/seo";

const jsonLd = buildProductJsonLd({ name, price, ... });

// V JSX:
{jsonLd && <script {...jsonLdScriptProps(jsonLd)} />}
```

**PRAVIDLO:** JSON-LD MUSÍ být v Server Component (SSR HTML), NIKDY v Client Component.

### 3. Agent-First endpointy

```
src/app/llms.txt/route.ts                — Markdown manifest pro AI agenty
src/app/api/products/feed.json/route.ts   — JSON feed všech produktů s variantami/cenami
```

- `/llms.txt` — popisuje eshop, odkazuje na feed.json a MCP endpoint
- `/api/products/feed.json` — kompletní produktový feed, stránkovaný fetch, cache 1h
- Oba endpointy používají `brandConfig` pro dynamický obsah

### 4. MCP Server (Model Context Protocol)

```
src/mcp-server/
  index.ts                — McpServer setup, registrace nástrojů + MCP Apps resources
  saleor-client.ts        — Lightweight GraphQL client pro MCP tools
  apps/                   — MCP Apps layer (Fáze F)
    registry.ts           — APP_RESOURCES map: 6 ui://saleor/*.html resources
    serve-html.ts         — load bundle + inject brand.css + window.__BRAND__
    csp.ts                — buildCsp() → { resourceDomains, connectDomains }
    paired-tools.ts       — registerToolPair + pairedAppToolName ("name" → "name_full")
    sanitize.ts           — sanitizeForLlm (12 injection vectors) + wrapAsData (delimiter)
    data-policy.ts        — FIELD_CLASSES table (5 classes) + classifyPath
    index.ts              — registerAllAppResources(server)
  tools/
    search.ts             — search_products
    categories.ts         — list_categories, get_category_products
    products.ts           — get_product_detail, compare_products
    collections.ts        — get_collections
    store-info.ts         — get_store_info
    checkout.ts           — 5 authenticated checkout tools
src/app/mcp/route.ts      — HTTP endpoint (WebStandardStreamableHTTPServerTransport)
```

**Read-only tooly:** 7 veřejných (search, categories, products, collections, store-info). Žádná autentizace. Stateless mód.
**Checkout tooly:** 5 mutujících (create/get/update/complete/cancel) — vyžadují agent identity přes Phase B verifyAgentRequest.

**Závislosti:** `@modelcontextprotocol/sdk@^1.29`, `@modelcontextprotocol/ext-apps@1.7.1`, `zod`

**Testování MCP:**

```bash
# Inspect tools
npx @modelcontextprotocol/inspector http://localhost:3000/mcp

# Nebo přes curl (JSON-RPC)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
```

### 4.5 MCP Apps — visual UI vrstva (Fáze F, in progress)

Storefront staví na MCP Apps spec (`2026-01-26`) — k existujícím MCP tools přidává `_meta.ui.resourceUri` na `ui://saleor/*.html` resources, které host (Claude Desktop, VS Code Copilot, Goose, Postman, MCPJam) renderuje jako sandboxovaný iframe. Tools nadále vrací JSON, `_meta.ui` je čistě aditivní — hosty bez MCP Apps podpory dostanou stále validní text response.

**Workspace `src/mcp-apps/`** (izolovaný Vite + tsconfig, nedotýká se Next.js builds):

```
src/mcp-apps/
  vite.config.ts          — per-view build (MCP_APPS_VIEW env), vite-plugin-singlefile
  tsconfig.json           — vlastní, baseUrl=../.. pro @/* alias
  views/                  — 6 entry HTML wrapperů
    product-card.html, product-list.html, product-detail.html,
    cart-preview.html, checkout-summary.html, order-receipt.html
  src/
    entries/              — entry .tsx per view (F1–F3 jsou stuby, F4+ real)
    components/           — sdílené React komponenty (F4+ vytváří ProductCard, ProductList, ...)
    bridge.ts             — createBridge(name) — wrapuje App z ext-apps
                             • onResult(handler) — JSON.parse text content
                             • callTool(name, args) — tools/call přes hosta
                             • openLink(url) — ui/open-link
                             • sendUiMessage(msg) — typed-enum ui/message (F3)
                             • fetchAppData(toolName, args) — paired _full tool (F3)
                             • sendMessage (legacy, @deprecated)
    ui-messages.ts        — UiMessage discriminated union (4 kinds) + renderUiMessage
    theme.ts              — getBrand() reads window.__BRAND__ (cross-tenant fallback)
    types.ts              — AppPayload base (rozšířen per view v F4+)
  dist/                   — git-ignored, output `views/<name>.html` ~60 KB gzip each
```

**Architektonické konvence (NEPORUŠOVAT):**

1. **Paired-tool pattern pro PII** — pro každý tool s `customer-pii` / `business-confidential` poli v full payloadu **MUSÍ** být registrace přes `registerToolPair({resourceUri, model, app})`. Model tool vrací minimal (`public` + `cart-state`), `<name>_full` tool má `visibility: ["app"]`, NENÍ v `tools/list`, iframe ho volá přes `bridge.fetchAppData(toolName, args)`. Plánováno v F6 (cart) + F7 (checkout/order).
2. **Standalone app-only tools** — UI affordances (`update_cart_line`, `select_shipping_method`, `apply_loyalty_code`, `complete_checkout`) registrujeme přímo přes `registerAppTool` s `visibility: ["app"]`, ne `registerToolPair`. Model je nikdy neuvidí v `tools/list`.
3. **Sanitization** — VŠECHEN free-form user content (product description, customer notes, reviews) `sanitizeForLlm(text)` před tím, než se serializuje do model-visible content bloku. Strip 12 prompt-injection vektorů.
4. **Delimiter wrapping** — VŠECHNY model-visible text content bloky obal `wrapAsData(jsonText, "kind-label")` — defense proti indirect prompt injection. `sanitizeAndWrap` helper pro prose-only kanály.
5. **ui/message** — iframe **NIKDY** nevolá `bridge.sendMessage(freeFormText)` — jen `bridge.sendUiMessage({kind, ...ids})` typed-enum. Server-rendered neutrální text, žádné částky/adresy/emaily v zprávách.
6. **Žádný api_key / OAuth JWT / payment_token v iframe payloadech** — host re-injektne agent identitu z původního session přes subject preservation.
7. **`ui://saleor/<name>.html`** — naming convention pro všechny UI resources. Group prefix předchází kolizím s jinými MCP servery.
8. **brand.css inline + `window.__BRAND__`** — runtime injectované do served HTML před React mountem (viz `serve-html.ts`). Per-tenant theming bez Vite rebuilds.
9. **Edge-runtime safe** — žádný `node:crypto` v iframe ani v serve-html path. `globalThis.crypto.subtle` jen.
10. **CSP allowlist přes env** — `NEXT_PUBLIC_SALEOR_API_URL` + `NEXT_PUBLIC_MEDIA_CDN_ORIGIN` + `MCP_APPS_EXTRA_RESOURCE_DOMAINS` / `MCP_APPS_EXTRA_CONNECT_DOMAINS`. Žádný hard-code.

**Build + test workflow:**

```bash
pnpm run build:mcp-apps    # Vite per-view loop, výstup do src/mcp-apps/dist/views/
pnpm exec tsc --noEmit                              # root tsconfig
pnpm exec tsc --noEmit -p src/mcp-apps/tsconfig.json # mcp-apps tsconfig
pnpm exec vitest run                                 # všech 455 tests (stav po F3)
pnpm run build                                       # Next.js — prebuild chainuje build:mcp-apps
```

Bundle budget: **250 KB gzip per view** (build script flagne ⚠️ over budget).
Pre-existing `/checkout` cacheComponents/Suspense bug pořád blokuje plný `next build` — unrelated k MCP Apps, separátní fix.

**Klíčové docs:**

- **`docs/mcp-apps-readme.md`** — developer guide (F9). **Začni tady** pokud přidáváš nový view, ladíš bundle size, nebo procházíš smoke checklist.
- `docs/mcp-apps-threat-model.md` — security model, mitigation matrix, spec resolution log (CSP shape ✅, per-content-block visibility ❌ → paired-tool ✅).
- `docs/mcp-apps-spec-pinning.md` (F8) — kdy a jak bumpnout `@modelcontextprotocol/ext-apps`, smoke matrix, escape-hatch dokumentace.
- `docs/mcp-apps-spec-snapshot-2026-01-26.md` (F9) — provenance freeze; nesahej, jen referenc z spec-pinning při bumpech.
- `docs/announcements/2026-mcp-apps-launch.md` (F9) — 1-pager pro Algaweb klienty, co se mění pro koncové uživatele.
- `agentic-commerce-2026-plan.md` — plán fáze F (F1–F9), `Stav implementace` na konci dokumentu.
- `~/code/storefront/CLAUDE.md` (this file) — top-of-file status panel.

**Status (stav 13. května 2026):**

- ✅ **F1** — Vite build pipeline, ext-apps@1.7.1 + SDK ^1.29.
- ✅ **F2** — 6 ui:// resources registered, theme injection, CSP, bridge.
- ✅ **F3** — Paired-tool helper, sanitize + wrapAsData, ui-messages typed-enum, threat model. 455/455 tests pass.
- ✅ **F4** — Catalog tools `search_products` + `get_category_products` wired to `ui://saleor/product-list.html` via `registerAppTool` + `_meta.ui.resourceUri`. `get_collections` scope-deferred (samostatná collection view F-později). No paired-tool (catalog `public` class). Tool responses wrapped by `wrapAsData(..., "product-list")`. ProductCard + ProductList React components (responsive CSS grid; embla skipped — sandbox compat, stays well under 200 KB gzip target). Entries replace F2 stub; click calls `get_product_detail({slug})`. `bridge.onResult` auto-unwraps BEGIN/END delimiter via new `unwrapAsData` helper so all F4+ views inherit the convention. 468/468 tests pass; commit 241bf665.
- ✅ **F5** — Product detail view (`get_product_detail` + `compare_products`) sdílí `ui://saleor/product-detail.html` přes discriminated `ProductDetailPayload` (`mode: "single" | "compare"`). No paired-tool — payload stays in `public` class. `parseEditorJSToText` + `sanitizeForLlm` na product description, `wrapAsData(..., "product-detail")` na celý JSON. Nové komponenty `MediaGallery` / `VariantSelector` / `AttributeTable` / `ProductDetail`. Add-to-cart click přepošle `create_checkout` přes bridge BEZ `api_key` (host preserves identity; F6 doplní). Bundle: product-detail 137.4 KB gz. 474/474 tests pass; commit 3f2598cb.
- ✅ **F6** — First paired-tool surface. `get_cart` (paired model) + `get_cart_full` (paired app, `visibility:["app"]`, hidden from `tools/list`) sdílí `ui://saleor/cart-preview.html`; iframe pulls PII shape via `bridge.fetchAppData("get_cart", {checkout_id})`. Standalone app-only `update_cart_line` handles qty steppers. `create_checkout` + `get_checkout` migrated to `registerAppTool` with cart-preview view; both return `CartPreviewPayload` (no PII), wrapped. `api_key` optional throughout — iframe-relayed calls omit it, HTTP agents may still pass. Nové komponenty `CartLine` + `TotalsBlock` + `CartPreview`. Proceed CTA volá `sendUiMessage({kind:"cart.proceed_to_checkout"})` — první F3 typed-enum konzumovaný. Bundle: cart-preview 137.6 KB gz. 482/482 tests pass; commit f9392161.
- ✅ **F7** — Checkout summary + order receipt views. `get_checkout` rehomed → paired (model+full v `tools/checkout-summary.ts`). NEW paired `get_order` + `get_order_full` (`tools/order-receipt.ts`). `update_checkout` + `complete_checkout` → `registerAppTool` s `visibility:["app"]` (hidden from `tools/list`, iframe-only). Po platbě `complete_checkout` natáhne nově vytvořenou order přes ORDER_BY_ID_QUERY pro reálnou 7-field receipt. Allow-listed key sety: checkout summary = 9 klíčů, order receipt = 7. Nové komponenty `AddressBlock`, `ShippingPicker`, `CheckoutSummary` (Confirm CTA fires `sendUiMessage({kind:"checkout.confirm_requested"})` — payment_token NIKDY v iframe), `OrderReceipt`. Bundles (gz): checkout-summary 138.5 KB, order-receipt 137.9 KB. 492/492 tests pass; commit e1cea6d4.
- ✅ **F8** — Three fallback layers: feature flag, handshake timeout, ErrorBoundary. `MCP_APPS_ENABLED` env (default ON; `false`/`0`/`no`/`off` disable). Flag-aware `registerAppTool` shim strips `_meta.ui` when off; `registerToolPair` skips `_full` sibling entirely. `ErrorBoundary` wraps all six entries, fires `sendUiMessage({kind:"view.error", view, code:"render_error"})` on render error. `bridge.ts` 5s `HANDSHAKE_TIMEOUT_MS` race vs `app.connect()` → `<pre>` JSON dump v `document.body` (escapes `<`). Nový `docs/mcp-apps-spec-pinning.md` (7 sekcí). 501/501 tests pass; commit 5e956af7.
- ✅ **F9** — Phase F closure. `telemetry.ts` (`logAppView` přes Phase B `logAgentAction`, wired do `registerAppResource` read callback). Hard bundle budget v `build-mcp-apps.mjs` (>250 KB gz → `process.exit(1)`; `MCP_APPS_BUNDLE_BUDGET_KB` env override). `csp.test.ts` (8 env-permutation cases). Čtyři nové docs: developer readme (9-step smoke), spec snapshot 2026-01-26 (provenance freeze), Czech client announcement, plus `AGENTS.md` + `MIGRATION.md` cross-references. 509/509 tests pass; commit 189637b8.

**Phase F: ✅ COMPLETE.** Full agent-shopping flow v MCP-Apps-aware hostech. Manual smoke proti Claude Desktop queued for Jirka's sign-off. Next: Phase D (Czech moat — Comgate, GoPay, Zásilkovna fulfillment, ARES IČO/DIČ) — nezávislá na F.

### 5. brand.ts — branding konfigurace

`src/config/brand.ts` obsahuje centrální branding:

- `siteName`, `organizationName`, `defaultBrand` — názvy
- `copyrightHolder` — pro copyright notice
- `tagline`, `description` — meta popisky
- `logoAriaLabel` — accessibility
- `titleTemplate` — "%s | Store Name"
- `social.twitter`, `social.instagram`, `social.facebook` — sociální sítě (vše `null`)

**SEO pole (✅ přidáno):**

- `logoUrl` — cesta k logu, default `"/logo.svg"` (pro Organization JSON-LD)
- `contactPhone` — telefon, default `null` (pro Organization JSON-LD + llms.txt)
- `contactEmail` — email, default `null` (pro Organization JSON-LD + llms.txt)

**PRAVIDLO:** Při onboardingu nového klienta VŽDY vyplnit VŠECHNA pole v brand.ts.

### 6. Nové GraphQL queries

```
src/graphql/SitemapProducts.graphql     — slug + updatedAt, paginated
src/graphql/SitemapCategories.graphql   — slug only
src/graphql/SitemapCollections.graphql  — slug only, channel-scoped
src/graphql/SitemapPages.graphql        — slug only
src/graphql/AllCategories.graphql       — hierarchy + product counts (MCP)
src/graphql/AllCollections.graphql      — descriptions + product counts (MCP)
```

Tyto queries jsou lightweight a NEPOUŽÍVAJÍ existující heavy fragmenty (`ProductListItem`).
Po nastavení `NEXT_PUBLIC_SALEOR_API_URL` spustit `pnpm run generate`.

---

## Agentic Commerce Protocols (ACP + UCP)

Dva protokoly umožňující AI agentům (ChatGPT, Google Gemini) nakupovat programaticky.
PRD: `saleor-agent-first-prd.md`

### Stav implementace

| Fáze                         | Stav      | Popis                                      |
| ---------------------------- | --------- | ------------------------------------------ |
| Phase 1: Foundation          | ✅ Hotovo | Shared utils, typy, UCP profil, ACP feed   |
| Phase 2: UCP checkout (REST) | ✅ Hotovo | create/get/update/complete/cancel checkout |
| Phase 3: ACP checkout        | ✅ Hotovo | ACP checkout + Stripe payment token        |
| Phase 4: MCP checkout tools  | ✅ Hotovo | 5 authenticated MCP tools (12 total)       |
| Phase 5: Order management    | ✅ Hotovo | Webhook handler, UCP/ACP order status      |

### Struktura kódu

```
src/lib/protocols/
├── shared/
│   ├── types.ts          — Shared types (ProtocolMoney, ProtocolAddress, CheckoutStatus)
│   ├── money.ts          — Currency minor units conversion (toMinorUnits/fromMinorUnits)
│   ├── address.ts        — Address format normalization (Saleor ↔ protocol)
│   └── auth.ts           — Agent API key validation + UCP-Agent header
├── acp/
│   ├── types.ts          — ACP types (AcpProduct, AcpCheckoutSession)
│   └── product-mapper.ts — Saleor product → ACP feed format
└── ucp/
    ├── types.ts          — UCP types (UcpProfile, UcpCapability)
    └── profile-builder.ts — Generates /.well-known/ucp profile
```

### Endpointy

| Endpoint                                         | Protokol | Popis                                 |
| ------------------------------------------------ | -------- | ------------------------------------- |
| `GET /.well-known/ucp`                           | UCP      | Business profile (discovery)          |
| `GET /api/acp/products/feed`                     | ACP      | Product feed pro OpenAI               |
| `POST /api/ucp/rest/checkout-sessions`           | UCP      | Create checkout                       |
| `GET/PATCH /api/ucp/rest/checkout-sessions/[id]` | UCP      | Get/update checkout                   |
| `POST .../[id]/complete`                         | UCP      | Complete with payment                 |
| `POST .../[id]/cancel`                           | UCP      | Cancel checkout                       |
| `POST /api/acp/checkout`                         | ACP      | Create checkout session               |
| `GET/PATCH /api/acp/checkout/[id]`               | ACP      | Get/update session                    |
| `POST /api/acp/checkout/[id]/complete`           | ACP      | Complete with Stripe token            |
| `GET /api/products/feed.json`                    | —        | Existující feed (lidský formát)       |
| `GET /api/ucp/rest/orders/[id]`                  | UCP      | Order status                          |
| `GET /api/acp/orders/[id]`                       | ACP      | Order status                          |
| `POST /api/webhooks/saleor`                      | —        | Saleor webhook handler (order events) |
| `POST /mcp`                                      | MCP      | 12 tools (7 read-only + 5 checkout)   |

### Env variables (protocols)

```env
ACP_ENABLED=false                    # Zapnout ACP endpointy
ACP_API_KEY=                         # API klíč pro OpenAI
UCP_ENABLED=false                    # Zapnout UCP endpointy
UCP_VERSION=2026-04-08               # Verze UCP spec (plán fáze A bumpl z 2026-01-23)
STRIPE_PUBLISHABLE_KEY=              # Pro UCP payment handler
AGENT_API_KEYS=                      # Čárkou oddělené API klíče pro agenty
SALEOR_WEBHOOK_SECRET=               # HMAC secret pro verifikaci Saleor webhooků
```

### OAuth2 Authorization Server (Phase 6)

AI agenti (ChatGPT, Gemini) se autentizují zákazníkem přes OAuth2 Authorization Code + PKCE flow.

**Flow:** Agent → `/oauth/authorize` → zákazník se přihlásí → consent → redirect s auth code → `/oauth/token` → JWT access token

**Endpointy:**
| Endpoint | Metoda | Popis |
|----------|--------|-------|
| `/oauth/authorize` | GET (page) | Login + consent screen |
| `/oauth/consent` | POST | Zpracování přihlášení, generování auth code |
| `/oauth/token` | POST | Výměna code→token, refresh token rotation |
| `/oauth/userinfo` | GET | OIDC UserInfo (profil zákazníka) |
| `/oauth/revoke` | POST | Revokace refresh tokenu |

**Knihovna (`src/lib/oauth/`):**

- `config.ts` — Client registry z env, secret hash verification
- `codes.ts` — Authorization code store (5min TTL, single-use)
- `tokens.ts` — HMAC-SHA256 JWT signing/verification, token rotation
- `pkce.ts` — PKCE S256 verification
- `scopes.ts` — Scope definitions (profile, checkout, orders, addresses)
- `saleor-auth.ts` — Bridge: OAuth → Saleor tokenCreate

**Env variables:**

```env
OAUTH_JWT_SECRET=             # Min 32 znaků, pro podepisování JWT (POVINNÉ)
OAUTH_CLIENTS=                # Registry: id:secret_hash:redirect_uri1|uri2
OAUTH_ACCESS_TOKEN_TTL=3600   # Access token lifetime (default 1h)
OAUTH_REFRESH_TOKEN_TTL=2592000  # Refresh token lifetime (default 30d)
```

**Bezpečnost:**

- PKCE S256 povinné (plain odmítnuto)
- Authorization codes: single-use, 5min TTL, vázané na client+redirect_uri
- Client secrets jako SHA-256 hash, timing-safe porovnání
- Refresh token rotation (single-use)
- Redirect URI exact match proti client registry

### Pravidla pro protocols vrstvu

1. **Používej `saleorQuery` pattern** — lightweight raw GraphQL, bez codegen
2. **Minor units** — oba protokoly používají centy, Saleor decimální. Vždy konvertuj přes `toMinorUnits()`
3. **Feature flags** — `ACP_ENABLED`/`UCP_ENABLED` kontrolují dostupnost endpointů
4. **Auth** — `validateAgentApiKey()` z `shared/auth.ts` pro všechny mutační endpointy
5. **NEEXPONUJ admin mutations** — protokoly jsou pro nákup, ne pro správu produktů

---

## Pravidla pro AI agenty pracující s touto šablonou

### Architektura — co NEDĚLAT

1. **NEMODIFIKUJ `src/gql/`** — auto-generované typy, vždy generuj přes `pnpm run generate`
2. **NEPIŠ vlastní checkout/cart logiku** — Paper checkout je otestovaný a funkční
3. **NEPOUŽÍVEJ `@saleor/sdk`** — je deprecated, používej `executePublicGraphQL` z `src/lib/graphql.ts`
4. **NEMĚŇ `src/lib/graphql.ts`** Result pattern — používej `if (!result.ok)` pattern
5. **NEPŘIDÁVEJ admin Saleor mutations do MCP** — MCP je read-only pro veřejná data
6. **NEFETCHUJ Saleor a Payload sekvenčně** — vždy `Promise.all` pro paralelní fetch

### SEO — povinné kroky při přidání nové stránky

1. Přidej `generateMetadata()` s `buildPageMetadata()` pro OG/Twitter/canonical
2. Přidej BreadcrumbList JSON-LD pokud stránka má breadcrumby
3. Pro katalogové stránky přidej CollectionPage JSON-LD
4. JSON-LD MUSÍ být v Server Component (ne `'use client'`)
5. Přidej stránku do sitemap query pokud je veřejně indexovatelná
6. Ověř přes Google Rich Results Test

### MCP — jak přidat nový tool

1. Vytvoř soubor v `src/mcp-server/tools/`
2. Exportuj funkci `registerXxxTools(server: McpServer)`
3. Uvnitř zavolej `server.tool(name, description, zodSchema, handler)`
4. Handler volá `saleorQuery()` z `../saleor-client.js` a vrací `{ content: [{ type: "text", text: JSON.stringify(data) }] }`
5. Zaregistruj v `src/mcp-server/index.ts`
6. **Nikdy neexponuj admin mutations** (productCreate, orderUpdate, staffCreate atd.)

### Caching strategie

| Vrstva                 | Cache                          | Revalidace           |
| ---------------------- | ------------------------------ | -------------------- |
| Product/category pages | ISR 5 min                      | Webhook + `cacheTag` |
| Sitemap                | `next.revalidate: 3600`        | Automaticky po 1h    |
| Product feed           | `Cache-Control: max-age=3600`  | Automaticky po 1h    |
| llms.txt               | `Cache-Control: max-age=86400` | Automaticky po 24h   |
| MCP tools              | Žádný cache                    | Real-time            |
| Cart/checkout          | `cache: "no-cache"`            | Vždy live            |

### Branding — co vyplnit pro nového klienta

V `src/config/brand.ts`:

```ts
siteName, organizationName, defaultBrand; // Název obchodu
tagline, description; // Popisky
logoUrl, contactPhone, contactEmail; // Pro structured data
social.twitter, social.instagram, social.facebook; // Sociální sítě
titleTemplate; // "%s | Název Obchodu"
```

V `src/styles/brand.css`:

```css
--color-primary, --color-secondary  // Barvy (OKLCH)
```

V `.env`:

```
NEXT_PUBLIC_SALEOR_API_URL         // Saleor GraphQL endpoint
NEXT_PUBLIC_DEFAULT_CHANNEL        // Channel slug
NEXT_PUBLIC_STOREFRONT_URL         // Veřejná URL
```

---

## Startup Checklist — Nový klientský projekt

Toto je **šablona**. Při kopírování pro nového klienta postupuj podle tohoto checklistu:

### 1. Nastavení prostředí

```bash
git clone <this-repo> client-storefront
cd client-storefront
cp .env.example .env
```

Vyplň `.env`:

```
NEXT_PUBLIC_SALEOR_API_URL=https://klient.saleor.cloud/graphql/   # POVINNÉ
NEXT_PUBLIC_DEFAULT_CHANNEL=cesky-kanal                            # POVINNÉ
NEXT_PUBLIC_STOREFRONT_URL=https://www.klient.cz                   # Pro SEO
SALEOR_APP_TOKEN=                                                  # Volitelné, pro multi-channel
```

### 2. Branding

Edituj `src/config/brand.ts` — vyplň VŠECHNA pole:

- `siteName`, `organizationName`, `defaultBrand` — název obchodu
- `copyrightHolder` — právní subjekt
- `tagline`, `description` — meta popisky
- `logoUrl` — cesta k logu (relativní, např. `"/logo.svg"`)
- `contactPhone`, `contactEmail` — pro structured data a llms.txt
- `social.*` — sociální sítě
- `titleTemplate` — `"%s | Název Obchodu"`

### 3. Vizuální identita

Edituj `src/styles/brand.css`:

- `--color-primary`, `--color-secondary` — barvy (OKLCH formát)
- Fonty, border-radius, spacing

### 4. Logo a favicony

Nahraď soubory v `public/`:

- `logo.svg` (nebo jiný formát)
- `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`
- `favicon-dark-16x16.png`, `favicon-dark-32x32.png` (tmavý režim)
- `apple-icon.png`, `opengraph-image.png`

### 5. Locale konfigurace

Zkontroluj `src/config/locale.ts`:

- Pro český e-shop: `default: "cs-CZ"`, `graphqlLanguageCode: "CS_CZ"`
- Pro anglický e-shop: `default: "en-US"`, `graphqlLanguageCode: "EN_US"`

### 6. Instalace a generování typů

```bash
pnpm install
pnpm run generate:all    # Generuje GraphQL typy ze Saleor API
```

⚠️ `generate:all` vyžaduje funkční `NEXT_PUBLIC_SALEOR_API_URL` v `.env`!

### 7. Ověření

```bash
pnpm dev                  # Dev server — ověř homepage, produkty, checkout
pnpm exec tsc --noEmit    # Type check
pnpm run build            # Produkční build
```

### 8. Deploy

- **Cloudflare Pages**: Root `/`, build command `pnpm run build`, output `out` (s `NEXT_OUTPUT=export`) nebo `.next` (server mode)
- **Vercel**: Automatická detekce Next.js, jen nastavit env variables

---

## 🚀 Deployment — Cloudflare Workers (OpenNext) + durable-store env

> **Target decided:** Cloudflare **Workers** (NOT Pages — Pages can't run this Next.js app). Each client storefront = its own Worker, all sharing ONE Supabase durable store, isolated by `STORE_TENANT_PREFIX`. Later, higher-traffic deployments may move to Coolify (Node container) — the store backend works on both.

**Not wired yet (TODO, separate from security work):** the repo has NO `wrangler.{toml,jsonc}`, `open-next.config.ts`, or `@opennextjs/cloudflare` dep. Workers deploy needs the OpenNext Cloudflare adapter scaffolded first. When doing it, verify the current OpenNext steps via Context7 (versions move fast).

**Required Worker config (`wrangler.jsonc`):**

```jsonc
{
	"name": "storefront-<client>",
	"compatibility_date": "2025-03-01",
	"compatibility_flags": ["nodejs_compat"], // REQUIRED — app uses node:crypto
	"vars": {
		"SUPABASE_URL": "https://retagzzznvtejlztdqcz.supabase.co",
		"STORE_TENANT_PREFIX": "<client>" // per-Worker tenant isolation
	}
}
```

- `nodejs_compat` is mandatory: `oauth/tokens.ts` (HMAC/randomBytes), `lib/timing-safe-equal.ts`, and the Saleor webhook import `node:crypto`. ed25519 uses WebCrypto `subtle` (native on Workers).
- Secret (never a var / never `NEXT_PUBLIC_`): `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`. Local dev: put it in `.dev.vars` (gitignored).
- OpenNext maps Worker vars + secrets onto `process.env`, so the existing `process.env.*` reads work.
- Store backend selection is automatic (`src/lib/store/index.ts` factory): Supabase (when `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set) → Upstash → in-memory.

**Supabase store is already provisioned** (project `retagzzznvtejlztdqcz`, schema `agent_store` + `public.agentkv_*` RPC + pg_cron GC) — see Block 9. Nothing more to do DB-side; just set the env above.

---

## 🔒 SECURITY AUDIT REMEDIATION TRACKER (2026-06-01)

> Full audit report: `docs/SECURITY_AUDIT_2026-06-01.md` (multi-agent STRIDE audit, HEAD ff532994).
> Verdict: **NOT production-ready.** 49 confirmed security findings (27 High · 9 Medium · 7 Low · 6 Info) + 32 quality findings.
> This is a resumable checklist. Mark `[x]` when done. Blocks are ordered for sequential work; note dependencies.

### ⏳ Progress (remediation branch `security-hardening`, pushed to GitHub origin)

| Block                     | Scope                                                                                        | Status                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 0                         | Config hardening (image proxy, headers, webhook fail-close, CI gate, cookie)                 | ✅ done                                                                                                                 |
| 1                         | Stored XSS — escape JSON-LD (8 call sites)                                                   | ✅ done (strict CSP deferred — `cacheComponents` conflict)                                                              |
| 7                         | SSRF guard on `webhook_url` (+18 tests)                                                      | ✅ done (DNS-rebinding residual)                                                                                        |
| 15                        | Low/Info hardening batch                                                                     | ✅ done (3 items deferred)                                                                                              |
| 3a                        | **Order IDOR** — ownership on order read + return/refund                                     | ✅ done                                                                                                                 |
| 3b                        | Cart/checkout agent-binding + ACP/approvals ownership                                        | ✅ done (UCP+ACP cart/checkout binding, ACP order, approvals; only lines/loyalty mutation routes remain — low severity) |
| 2                         | Auth fail-closed defaults (`validateApiKey`, `AGENT_API_KEYS`)                               | ✅ done (prod fail-closed; public `/mcp` tool split deferred to 3b)                                                     |
| 4                         | ACP → guard chain + delete deprecated auth                                                   | ✅ done (all ACP routes on withAcpRoute; validateAgentApiKey/validateOAuthToken deleted)                                |
| 9                         | Durable store (Upstash Redis via REST, swappable) — INFRA                                    | ✅ code done (KvStore + in-memory + Upstash; codes/tokens/limits migrated). Operator step: provision Upstash at deploy  |
| 6                         | Saleor tokens out of JWT (server-side keyed by jti) + refresh re-auth                        | ✅ done (incl. Block 12 refresh-rotation core)                                                                          |
| 5,8,10,11,13,14 + 12-rest | signing replay, idempotency, rate-limit, scope, perf, quality/tests, verifyJwt base64url/alg | ⏳ TODO                                                                                                                 |

**Closed so far:** 8 HIGH (SSRF webhook_url, stored XSS, open image proxy, webhook fail-open, order IDOR, Saleor-token-in-JWT) + ACP completion bypass + auth fail-closed + cart/checkout IDOR + many Med/Low/Info. Full test suite green throughout (now 558/558); every block committed separately.

**Manual follow-ups (not code):** (1) mark `CI / verify` as a required status check in GitHub branch protection; (2) decide CSP strategy vs `cacheComponents`; (3) GitLab mirror push URL on `origin` has a stale/expired PAT in `.git/config` (push to GitHub works; GitLab leg fails) — rotate or remove it.

### Effort legend

S = small (config/1-file, ~minutes) · M = medium (a few files + logic) · L = large (cross-cutting / needs infra)

---

### BLOCK 0 — Config hardening quick wins · size: **S** · no logic, low risk

- [x] Remove `{ hostname: "*" }` from `remotePatterns` (open image proxy / SSRF) — `next.config.js`. Now dev-only (`NODE_ENV==='development'`); Saleor hosts pinned to `protocol: "https"`.
- [x] Add security-headers `headers()` block: `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, HSTS (prod) — `next.config.js`. **NOTE: full CSP deferred to Block 1** (needs a per-request nonce for the inline JSON-LD `<script>` blocks). `frame-ancestors 'none'` is covered by `X-Frame-Options: DENY` globally (incl. `/oauth/*`).
- [x] Saleor webhook fail-closed when `SALEOR_WEBHOOK_SECRET` unset (returns 503) — `src/app/api/webhooks/saleor/route.ts`.
- [x] CI: `lint.yml` → `pnpm install --frozen-lockfile`; new `.github/workflows/ci.yml` on `pull_request`/`push:main` runs generate→`tsc --noEmit`→lint→`test:run`. **TODO (manual, GitHub UI): mark `CI / verify` as a required status check in branch protection.**
- [x] `poweredByHeader: false` — `next.config.js`. [INFO]
- [x] `NEXT_LOCALE` cookie `secure: NODE_ENV==='production'` — `src/middleware.ts`. [INFO]

### BLOCK 1 — Stored XSS in JSON-LD · size: **S/M**

- [x] [HIGH] Escape JSON-LD before `dangerouslySetInnerHTML` (`</script>` breakout). Added `serializeJsonLd()` (escapes `<`/`>`/`&`/U+2028/U+2029) + `<JsonLdScript>` component in `src/lib/seo/`; `jsonLdScriptProps` now also escapes. Routed ALL 8 call sites through `<JsonLdScript>` (home ×2, products ×2, categories, collections, blog list, blog detail). Verified no raw `application/ld+json` `JSON.stringify` remains in `src/app`; tsc clean. CWE-79.
- [ ] [DEFERRED] Full strict CSP (`script-src` nonce) — **NOT added in Block 1.** Rationale: a per-request nonce forces dynamic rendering and conflicts with this app's `cacheComponents: true` (PPR) caching model. The stored-XSS finding is already fully closed by the escaping above; CSP would be defense-in-depth. Decide deliberately in a dedicated task (either drop a nonce-CSP, use a hash-based CSP, or accept the cache trade-off). Baseline non-CSP headers already shipped in Block 0.

### BLOCK 2 — Auth fail-closed defaults · size: **M** · touches auth core

- [x] [HIGH] MCP `validateApiKey` fail-closed — new shared `src/mcp-server/tools/api-key-auth.ts` `isMcpApiKeyAuthorized` (also dedups the 5 copies → partial Block 14). `undefined` ("trust transport") and empty `AGENT_API_KEYS` are honored ONLY in dev/test or with `MCP_TRUST_TRANSPORT=true`; in production they fail closed. Wired into `checkout.ts` (validateApiKey) + `cart-preview.ts`/`order-receipt.ts`/`checkout-summary.ts` (validateOptionalApiKey). CWE-306/862. **6 unit tests.**
- [x] [HIGH] `AGENT_API_KEYS` empty → production fail-closed in `auth.ts`: `verifyLegacyBearer` + `validateAgentApiKey` now reject (401/invalid) when no keys configured in production, unless `UCP_ALLOW_ANONYMOUS_LEGACY=true`. Dev/test keep legacy permissive behavior (so the dev-mode `legacy-bearer:anonymous` scope contract — relied on by route-handler/cart/checkout tests — is unchanged). CWE-1188. **2 unit tests.**
- [ ] [PARTIAL] Synthetic anonymous "empty scope + zero cap": NOT applied to dev mode — `route-handler.test.ts`/carts/checkout-sessions rely on dev anonymous having legacy scope (`cart.create` etc.). Production now rejects outright (above), which closes the deploy-time risk. Giving dev anonymous empty scope is a separate test-contract change; deferred.
- [ ] [DEFERRED → Block 3b/4] Stop registering payment/PII tools on the public `/mcp`, or gate `/mcp` with `verifyAgentRequest`. Mitigated now by the fail-closed `isMcpApiKeyAuthorized` (those tools refuse unauthenticated calls in production); the structural split / transport-auth is the proper fix. `/mcp/route.ts` comment + TODO updated. CWE-862.

### BLOCK 3 — IDOR / object ownership (THE big one) · size: **L** · most dangerous finding

**Phase 3a — Order ownership (DONE, the crown-jewel IDOR: read any customer's PII + refund any order):**

- [x] [HIGH] `saleorQuery` now takes an optional `{ authToken }` → `Authorization: Bearer` (root-cause enabler, backward compatible; all 111 existing 2-arg calls unaffected) — `src/mcp-server/saleor-client.ts`.
- [x] [HIGH] New `src/lib/protocols/shared/ownership.ts` `ownsOrder(order, auth)` — case-insensitive `order.userEmail === userContext.email`; requires a customer (OAuth) context, so agent-only tokens never own a customer order.
- [x] [HIGH] UCP `orders/[id]` GET — 404 unless `ownsOrder` (covers both non-owner and agent-only). CWE-639.
- [x] [HIGH] UCP `orders/[id]/return` — ownership check (404) after fetch, BEFORE eligibility/refund, so no one can refund another customer's order.
- [x] [TEST] `orders.test.ts` rewritten (was codifying IDOR): owner→200, different customer→404, agent-only→404, not-found→404. Added IDOR negative test to `orders-return.test.ts` (different customer→404, no refund mutation). Full suite 530/530.

**Phase 3b — Cart/checkout + ACP ownership (TODO, entangled with Block 4):**

- [x] [HIGH] UCP carts/checkout agent-binding — DONE. `ownsCheckout(checkout, auth)` in `ownership.ts` (binding-metadata match OR OAuth email match) + `agentBindingMetadataItem`. Both CREATE routes (`carts/route.ts`, `checkout-sessions/route.ts`) now ALWAYS write `ucp.agent_id` metadata. Ownership enforced (404 to non-owner) on: `carts/[id]` GET/PATCH/DELETE, `checkout-sessions/[id]` GET/PATCH, `checkout-sessions/[id]/cancel`, `checkout-sessions/[id]/complete`. 6 ownership tests; suite 549/549.
  - **ACP checkout binding + complete/GET ownership + approvals: DONE in Block 4b.**
  - **Remaining (lower severity, TODO):** `carts/[id]/lines` (+`[lineId]`) and `carts/[id]/loyalty` mutation routes don't yet check `ownsCheckout` (cart-item tampering / cart-content leak via mutation response — no PII read, no money movement).
- [x] [HIGH] ACP `orders/[id]` ownership — DONE in Block 4a: migrated to `withAcpRoute` (gives `userContext`), now applies `ownsOrder` (owner→200, other/agent-only→404). 3 tests.
- [ ] [LOW] Approval-status GET ownership (`approvals/[id]/route.ts`) — also legacy-auth; fold into Block 4 (compare `approval.agent_id` to the authenticated agent once it has a proper identity).

### BLOCK 4 — ACP onto guard chain + delete deprecated auth · size: **M/L**

**Phase 4a (DONE):**

- [x] New `src/lib/protocols/acp/route-handler.ts` `withAcpRoute` — ACP sibling of `withUcpRoute` (ACP_ENABLED flag + `verifyAgentRequest` + `hasScope` + `computeAmountCents`/`checkLimits` + activity log), plain JSON responses.
- [x] [HIGH] `acp/checkout/[id]/complete` migrated to `withAcpRoute`: scope `checkout.complete` + spending cap + B6 high-value approval gate (was bypassing ALL of them).
- [x] [HIGH] `acp/orders/[id]` migrated → scope `order.read` + `ownsOrder` (closes ACP order IDOR, Phase 3b). 5 ACP guard tests; 543/543 suite.

**Phase 4b (DONE):**

- [x] Remaining ACP routes migrated to `withAcpRoute`: `acp/checkout/route.ts` (create, scope `checkout.create`, now writes the `ucp.agent_id` binding), `acp/checkout/[id]/route.ts` (GET/PATCH, scope `checkout.create` + `ownsCheckout`), `acp/products/feed/route.ts` (scope `catalog.read`). ACP `complete` also gained `ownsCheckout` now that create binds.
- [x] `ucp/rest/approvals/[id]` migrated to `verifyAgentRequest` + `approval.agent_id === verify.agent.id` ownership (no scope — polling one's own approval); closes the LOW approvals IDOR.
- [x] DELETED `validateAgentApiKey` + `validateOAuthToken` from `auth.ts` (+ unused `AgentAuthResult` import). All ACP/UCP routes now go through the single `verifyAgentRequest` entry. +1 ACP checkout-IDOR test; 550/550 suite; tsc 0.

> **Block 4 COMPLETE.** Single auth entry point; the parallel-auth-path quality defect is resolved.

### BLOCK 5 — ed25519 signature scheme · size: **L** · (nonce store ties to Block 9)

- [x] [HIGH] Canonical signed-request scheme. New `buildSigningString({method, pathWithQuery, timestamp, nonce, bodyHashHex})` + `sha256Hex` in `signing.ts`. `verifySignedRequest` now: requires `UCP-Timestamp` (±300s skew) + `UCP-Nonce`; verifies the ed25519 sig over the canonical string (binds method/path/query/timestamp/nonce/body-hash, so a captured sig can't be replayed to another verb/path/resource and bodiless GETs no longer all sign `""`); rejects replayed nonces via `store.setnx` (new KvStore primitive, per-agent, TTL=skew); and reads the body STRICTLY (read failure → 401, was fail-open `""`). CWE-347. +3 anti-replay tests; auth.test signed cases rewritten to the canonical scheme; 561/561; tsc 0.
  - **Breaking protocol change — now SPECCED (resolved):** published machine-readable in the UCP profile (`GET /.well-known/ucp` → `request_signing`: required headers, canonical-string template, ed25519, 300s skew) + human spec `docs/agent-request-signing.md` (Web Crypto reference impl + curl pitfalls). New `UcpRequestSigning` type + profile field + a profile test locking the contract. Integrators discover signing from `/.well-known/ucp` — no out-of-band coordination. Outbound agent-webhook signing (server→agent, body-only) unchanged.

### BLOCK 6 — Saleor tokens out of JWT · size: **M** · (server store ties to Block 9)

- [x] [HIGH] Saleor tokens removed from JWT claims (`saleor_token`/`saleor_refresh_token` deleted from `JwtPayload`). `createTokenPair` now stores them server-side in the durable store keyed by the access/refresh `jti` (`oauth:saleor_at:` / `oauth:saleor_rt:`, with matching TTLs). `getSaleorAccessToken`/`getSaleorRefreshToken`/`deleteSaleorRefreshToken` added. `userinfo` looks up the access token by jti; `verifyOAuthBearer` no longer carries it (userContext.saleorToken = ""). CWE-522.
  - **Bonus (Block 12 core):** refresh grant now calls Saleor `tokenRefresh` (new `saleorTokenRefresh` in `saleor-auth.ts`) to get a fresh Saleor access token, fails the grant (re-auth) if Saleor rejects it, and rotates the OAuth refresh JTI + its Saleor binding. +2 tests; 558/558; tsc 0.
  - **Migration note:** OAuth refresh tokens issued before this change (Saleor token in the JWT, no server-side binding) will fail refresh → clients re-authenticate. Acceptable for a security fix.

### BLOCK 7 — SSRF on agent webhook_url · size: **M**

- [x] [HIGH] Validate `webhook_url` before server-side fetch. New `src/lib/protocols/shared/url-guard.ts` (`validateOutboundWebhookUrl`): require https, reject credentials-in-URL, block private/loopback/link-local/CGNAT/metadata IPv4, IPv6 loopback/ULA/link-local, decimal/hex IP encodings, and internal hostnames (`localhost`, `*.internal`, `*.local`, GCP metadata). Optional operator allowlist via `UCP_WEBHOOK_ALLOWED_HOSTS`. Enforced at acceptance (`return/route.ts` → 400) AND delivery (`agent-webhooks.ts` notifyAgent) + `redirect: "manual"` so 3xx can't bounce internal. 18 unit tests added; existing tests pass. CWE-918.
  - **Residual (edge-safe, no DNS):** a public hostname resolving to an internal IP (DNS rebinding) is NOT blocked — close via `UCP_WEBHOOK_ALLOWED_HOSTS` and/or network egress policy. Documented in `url-guard.ts`.

### BLOCK 8 — Idempotency & atomicity on money paths · size: **L** · (durable store ties to Block 9)

- [x] [HIGH] Checkout completion idempotency. New `src/lib/protocols/shared/idempotency.ts` (`acquireLock`/`releaseLock` over `store.setnx`). UCP + ACP complete routes take a per-checkout lock (`checkout-complete:<id>`) AFTER the approval gate, then charge+complete inside try/finally: lock released on failure (retryable), KEPT on success → concurrent POSTs / retries get 409 instead of a double charge. CWE-367.
- [x] [HIGH] Return/refund concurrency: UCP return route holds a per-order lock (`order-return:<id>`) across eligibility + `triggerSaleorRefund` (try/finally) → concurrent requests can't double-refund (409). CWE-367.
  - **Remaining (cross-instance durability):** `return-mapper` still keeps return records in an in-memory `Map`, so a SEQUENTIAL repeat on a different instance / after restart isn't caught by the eligibility check (the lock only covers concurrency). Proper fix = migrate `returnsStore` to the durable `KvStore` (a Block 9-style follow-up) or check existing Saleor refunds before triggering. Documented; lower-frequency than the concurrent race now closed.
- [x] +2 idempotency unit tests; 564/564; tsc 0.

### BLOCK 9 — Durable state backing · size: **L** · INFRA — unblocks 5/6/8/10

**Backend chosen: Supabase Postgres** (HTTP/RPC — works on CF Workers now + Coolify later, reuses the existing Algaweb project `retagzzznvtejlztdqcz`, zero new vendor). Swappable `KvStore` abstraction (Upstash adapter kept as alternative; dev/test in-memory). Priority: Supabase → Upstash → in-memory.

**Supabase side DONE (via MCP, project `retagzzznvtejlztdqcz`):** schema `agent_store` (`kv`/`kv_set`, RLS on / no policy → service*role-only) + `agent_store.kv*\_`fns (SECURITY INVOKER, pinned search_path) +`public.agentkv\_\_`RPC wrappers (EXECUTE only`service_role`→ storefront calls them via the service-role key, no exposed-schema change) +`pg_cron`job`agent_store_gc`(5 min). Advisor-clean (only benign RLS-no-policy INFO). Code:`SupabaseKvStore`+`PrefixedStore` (tenant key prefix) + factory wired. 564/564; tsc 0.

> ⚠️ Pre-existing advisor findings on OTHER apps in this SHARED project (NOT touched — need owner decision): `finance.execute_readonly_sql`, `public.upsert_invoice`, `public.upsert_tenant` are `anon`-executable SECURITY DEFINER (arbitrary read / invoice+tenant write via the public anon key); 5× `portal_*` SECURITY DEFINER views; permissive `codelens.*` RLS. Recommend a separate remediation pass on the portal/finance apps.

- [x] New `src/lib/store/` — `KvStore` interface (`get/set(ttl)/del/getdel/incr/incrby/expire/sadd/sismember/scard`) + `InMemoryKvStore` (dev/test/single-instance) + `UpstashKvStore` (REST) + `getStore()` factory (Upstash when `UPSTASH_REDIS_REST_URL`+`_TOKEN` set, else in-memory with a prod warning).
- [x] `oauth/codes.ts` → store; single-use now ATOMIC via `getdel` (replay-safe across instances), TTL-backed expiry.
- [x] `oauth/tokens.ts` revoked JTIs → store with refresh-token TTL (revocation holds across instances).
- [x] `limits.ts` → store: RPM fixed-window (`INCR`+`EXPIRE`), sessions/day (`SADD`/`SISMEMBER`/`SCARD`), per-day/month spend counters; new `recordSpend()` called after successful UCP+ACP checkout completion so caps reflect real cumulative spend.
- [x] Callers awaited (oauth consent/token/revoke). +12 tests (store 5, spend 2, plus async test updates). 557/557; tsc 0.
- [x] `.env.example` documents `UPSTASH_REDIS_REST_URL`/`_TOKEN` (+ `UCP_ALLOW_ANONYMOUS_LEGACY`, `MCP_TRUST_TRANSPORT`).
- [ ] **OPERATOR STEP (you, at deploy):** create a free Upstash Redis DB, set the 2 env vars. Until then prod runs in-memory (logs a warning) — fine for single-instance Sliplane, UNSAFE on Vercel/CF multi-instance.
- [ ] [follow-up, Block 8] `per_session_cents` cumulative + atomic reserve/commit (read-then-record is currently non-atomic TOCTOU). `recordSpend` + the store primitives are the foundation.

> **Block 9 code COMPLETE** (abstraction + Upstash adapter + in-memory + all three modules migrated). Only the deploy-time Upstash provisioning remains.

### BLOCK 10 — Rate limiting / brute-force · size: **M** · (needs Block 9 store)

- [ ] [MEDIUM] Per-IP + per-account rate limit + lockout on OAuth login/token + reset-password — `oauth/consent/route.ts:23-85`, `oauth/token/route.ts:43-79`, `auth/reset-password/route.ts:28-62`. CWE-307.

### BLOCK 11 — Scope enforcement · size: **M**

- [ ] [MEDIUM] Unmapped OAuth bearer defaults to full synthetic scope; `hasScope` checks `agent.scope` not consented `payload.scope`. Intersect consented + mapped scope — `auth.ts:250-261`. CWE-269.
- [ ] [LOW] Per-client scope allow-list (all clients get every scope today); implement or remove dead `allowed_scopes` — `oauth/config.ts:53-59`, consent + token routes. CWE-863.

### BLOCK 12 — JWT / refresh correctness · size: **M**

- [x] [LOW] On refresh, call Saleor `tokenRefresh`, fail if rejected, rotate stored tokens — DONE in Block 6 (`saleorTokenRefresh` + refresh-grant rewrite). CWE-613.
- [ ] [MEDIUM/quality] `verifyJwt` uses base64 not base64url for signature decode (intermittent valid-token rejection); also assert `alg==='HS256'` — `tokens.ts` (verifyJwt). Only remaining Block 12 item.

### BLOCK 13 — Performance · size: **M**

- [ ] [HIGH-perf] Global Saleor request queue adds unconditional ~200ms sleep + caps to 3 concurrent — drop sleep, back off only on observed 429s, exempt cache hits — `graphql.ts:124-181`.
- [ ] Cache read-only protocol queries (`saleorQuery` uncached); collapse triple checkout fetch (`complete/route.ts:74,103,171`); remove wasted activity-log GET (`agent-log.ts:143-154`); prune unbounded `revokedTokens`.

### BLOCK 14 — Quality / dedup / tests · size: **M**

- [ ] Dedup `validateApiKey` (5 copies, 2 conventions) + ACP PATCH apply block (6× + divergent MCP copy) into shared helpers.
- [ ] Fix misleading `complete_checkout` fallback that reports a paid order as `isPaid:false,total:0` — `checkout.ts:464-487`.
- [ ] Add charge-without-completion compensation (void/refund on `checkoutComplete` failure).
- [ ] Add negative/authz tests: IDOR 403, fail-open fallbacks, JWT alg/header tampering.

### BLOCK 15 — Low/Info hardening backlog · size: **S**

- [x] Cap OG param lengths (title 120 / subtitle 160 / price 40) — `og/route.tsx`. CWE-400. (Rate-limiting `/api/og` deferred to Block 10's shared limiter.)
- [x] `timingSafeEqual` on revalidate + cron secrets — new `src/lib/timing-safe-equal.ts` (`timingSafeEqualStr`, sha256-then-compare = constant-time + length-safe); wired into `revalidate/route.ts` + `cron/abuse-scan/route.ts`. CWE-208.
- [x] Generic upstream error msg to callers (log details server-side) — `saleor-client.ts`. CWE-209.
- [x] `Number.isInteger` + max (10 000) on cart line quantity — both `carts/[id]/lines/route.ts` and `lines/[lineId]/route.ts`. CWE-20.
- [x] Tighten tsconfig: `allowUnreachableCode:false` (tsc clean).
- [ ] [DEFERRED] `noUncheckedIndexedAccess:true` — would surface many errors across ~120k LOC; treat as its own typed-hardening task, not a quick win.
- [ ] [DEFERRED] Pin caret-ranged deps to exact — `package.json`. Low value (lockfile already pins + 24h minimumReleaseAge); needs lockfile regen. Do as a deliberate dep-hygiene pass.
- [ ] [DEFERRED] Gate ephemeral signing key behind `UCP_ALLOW_EPHEMERAL_SIGNING` + `kid` rotation — `signing.ts`. Prod already throws; gating dev/test ephemeral would break the test suite (relies on ephemeral keypair) without extra setup. INFO; revisit with signing-key rotation work.

> Side effect of Block 15: the Saleor webhook now reads `SALEOR_WEBHOOK_SECRET` at request time (was module-load), fixing a latent staleness bug and making the Block 0 fail-closed testable. `saleor-returns.test.ts` updated to send a valid HMAC signature. Full suite: 527/527 green.

### Dependency notes

- Block 9 (durable store) is the proper foundation for 5 (nonce), 6 (token store), 8 (idempotency), 10 (rate limit). Each can ship an interim single-instance version, but multi-instance/serverless deploy is unsafe until 9 lands.
- Blocks 0, 1, 7, 15 are independent — safe to do anytime.
