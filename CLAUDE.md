# CLAUDE.md — Algaweb E-commerce Platform

## Kdo jsem a co děláme

Jsem Jirka, provozuji **Algaweb** — českou webovou agenturu a managed hosting providera. Stavím e-shopy pro klienty na **Saleor** (headless e-commerce backend) s **Next.js** frontendem. Kóduji primárně přes AI (vibecoding). Komunikuji česky, ale technické dokumenty a kód píšu anglicky.

## Prodejní kanály — co tato šablona umožňuje

Šablona pokrývá **10 prodejních kanálů** z jednoho deploye, jednoho Saleor backendu.

### Lidské kanály (browser)

| Kanál | Popis | Implementace |
|-------|-------|-------------|
| **Webový eshop** | Klasický storefront — katalog, košík, checkout, zákaznický účet | Next.js App Router, Server Components, ISR caching |
| **Mobilní web** | Responzivní design, mobile-first, PWA-ready | Tailwind CSS, touch-optimized UI |
| **Google Search** | Rich results v Google — ceny, dostupnost, hodnocení | 5 JSON-LD builderů (Product, BreadcrumbList, Organization, WebSite, CollectionPage) |
| **Sociální sítě** | Náhledové karty při sdílení (Facebook, Twitter, LinkedIn) | OpenGraph + Twitter Card metadata na všech stránkách |
| **SEO / Crawlery** | Kompletní indexace pro vyhledávače | robots.txt, sitemap.xml (dynamický), canonical URLs |

### AI agentové kanály (programatické)

| Kanál | Popis | Implementace |
|-------|-------|-------------|
| **ChatGPT (ACP)** | Zákazník řekne "kup mi tohle" → ChatGPT provede checkout a platbu | ACP product feed + checkout REST API + Stripe payment tokens |
| **Google Gemini (UCP)** | Zákazník hledá v Google AI Mode → Gemini objeví eshop a dokončí nákup | `/.well-known/ucp` profil + REST checkout + MCP binding + capability negotiation |
| **Libovolný MCP agent** | Jakýkoli MCP-kompatibilní agent (Claude, Cursor, custom boty) | 12 MCP tools (7 read-only + 5 checkout) |
| **LLM crawlery** | Perplexity, SearchGPT a další AI vyhledávače rozumí eshopu | `/llms.txt` manifest s popisem obchodu a odkazy na data |
| **Strojové feedy** | Cenové srovnávače, agregátory, partnerské systémy | `/api/products/feed.json` — kompletní produktový feed |

### Autentizační modely

| Model | Použití | Implementace |
|-------|---------|-------------|
| **Guest checkout** | Zákazník bez účtu — browser i AI agent | Saleor anonymous checkout |
| **Zákaznický účet** | Login, uložené adresy, historie objednávek | Saleor JWT auth + cookie session |
| **OAuth2 (agent za zákazníka)** | AI agent propojí zákaznický účet → nakupuje s jeho daty | OAuth2 Authorization Code + PKCE, token rotation |
| **API klíč (agent-level)** | Platformy (OpenAI, Google) se autentizují partnerským klíčem | Bearer token z AGENT_API_KEYS env var |

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

| Data | Source of Truth | Důvod |
|------|----------------|-------|
| Produkty, varianty, ceny, sklad | **Saleor** | Commerce engine, kalkulace, validace |
| Objednávky, checkout, platby | **Saleor** | Transakční integrita |
| Zákazníci, košík | **Saleor** | Session management, auth |
| Slevy, vouchery, promotion rules | **Saleor** | Business logika |
| Blogy, stránky, landing pages | **Payload CMS** | Content management |
| Navigační menu, bannery | **Payload CMS** | Vizuální obsah |
| Média a obrázky (content) | **Payload CMS** | Asset management |
| SEO metadata (content stránky) | **Payload CMS** | Content-driven SEO |
| Product enrichment (delší popisy, tipy) | **Payload CMS** | Rozšířený obsah nad rámec Saleoru |
| Klientský admin přístup | **Payload CMS** | Unified login, multi-tenant |

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

| Systém | Izolace | Mechanismus |
|--------|---------|-------------|
| **Saleor** | 1 channel = 1 klient | Permission groups s `restrictedAccessToChannels: true` |
| **Payload** | 1 tenant = 1 klient | Oficiální `@payloadcms/plugin-multi-tenant` |
| **Storefront** | 1 deployment = 1 klient | Paper fork s channel-scoped routing |
| **AI Chat** | 1 OpenClaw instance = 1 klient | MCP servery scoped per tenant |

**PRAVIDLO:** Produkty v Saleoru VŽDY patří jen do jednoho channelu. Nikdy nesdílej produkty mezi klienty/channely.

---

## Technologický stack (NEMĚNIT bez konzultace)

| Vrstva | Technologie | Poznámka |
|--------|------------|----------|
| **Commerce engine** | Saleor (self-hosted) | GraphQL API, JEDINÝ source of truth pro commerce |
| **CMS** | Payload CMS (self-hosted, PostgreSQL) | Multi-tenant, white-labeled admin panel |
| **Storefront** | Next.js 16 + App Router (Paper template) | Server Components, React 19 |
| **Jazyk** | TypeScript (strict mode) | Povinné, žádné `any` v produkci |
| **Styling** | Tailwind CSS + CSS custom properties | Design tokeny v `src/styles/brand.css` |
| **UI komponenty** | shadcn/ui + Paper e-commerce komponenty | shadcn jako primitiva |
| **GraphQL** | GraphQL Codegen + TypedDocumentString | NEPOUŽÍVAT starý `@saleor/sdk` |
| **Hosting frontend** | Cloudflare Pages nebo Vercel | Statické + edge rendering |
| **Hosting backend** | Self-hosted (Cloudron/Docker) | Saleor + Payload na Algaweb infra |
| **Platby** | Saleor payment apps (Stripe, Adyen) | Integrace přes checkout flow |
| **AI Chat** | OpenClaw + MCP servery | Saleor MCP + Payload MCP + n8n MCP |
| **Package manager** | pnpm | Vyžadován Paper templatem |

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
    collection: 'product-enrichment',
    where: { saleorProductId: { equals: productId } }
  })
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

| MCP Server | Systém | Operace |
|-----------|--------|---------|
| Saleor MCP | Saleor GraphQL API | Produkty, objednávky, zákazníci, slevy |
| Payload MCP | Payload REST/GraphQL API | Blogy, stránky, média, enrichment |
| n8n MCP | n8n workflows | Komplexní operace napříč systémy |

**PRAVIDLO:** AI chat NIKDY nepřistupuje přímo k databázi. Vždy přes MCP servery s tenant-scoped API tokeny.

### Graduated autonomy pro AI

| Úroveň | Akce | Příklad |
|---------|------|---------|
| Auto-execute | Read-only dotazy | "Kolik mám objednávek?" |
| Execute + notify | Nízko-rizikové změny | "Změň popis produktu" |
| Draft + approve | Střední riziko | "Vytvoř nový produkt za 450 Kč" |
| Escalate | Vysoké riziko | "Smaž všechny produkty v kategorii" |

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
  index.ts                — McpServer setup, registrace nástrojů
  saleor-client.ts        — Lightweight GraphQL client pro MCP tools
  tools/
    search.ts             — search_products
    categories.ts         — list_categories, get_category_products
    products.ts           — get_product_detail, compare_products
    collections.ts        — get_collections
    store-info.ts         — get_store_info
src/app/mcp/route.ts      — HTTP endpoint (WebStandardStreamableHTTPServerTransport)
```

**7 veřejných read-only nástrojů.** Žádná autentizace. Stateless mód.

**Závislosti:** `@modelcontextprotocol/sdk`, `zod`

**Testování MCP:**
```bash
# Inspect tools
npx @modelcontextprotocol/inspector http://localhost:3000/mcp

# Nebo přes curl (JSON-RPC)
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}'
```

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

| Fáze | Stav | Popis |
|------|------|-------|
| Phase 1: Foundation | ✅ Hotovo | Shared utils, typy, UCP profil, ACP feed |
| Phase 2: UCP checkout (REST) | ✅ Hotovo | create/get/update/complete/cancel checkout |
| Phase 3: ACP checkout | ✅ Hotovo | ACP checkout + Stripe payment token |
| Phase 4: MCP checkout tools | ✅ Hotovo | 5 authenticated MCP tools (12 total) |
| Phase 5: Order management | ✅ Hotovo | Webhook handler, UCP/ACP order status |

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

| Endpoint | Protokol | Popis |
|----------|----------|-------|
| `GET /.well-known/ucp` | UCP | Business profile (discovery) |
| `GET /api/acp/products/feed` | ACP | Product feed pro OpenAI |
| `POST /api/ucp/rest/checkout-sessions` | UCP | Create checkout |
| `GET/PATCH /api/ucp/rest/checkout-sessions/[id]` | UCP | Get/update checkout |
| `POST .../[id]/complete` | UCP | Complete with payment |
| `POST .../[id]/cancel` | UCP | Cancel checkout |
| `POST /api/acp/checkout` | ACP | Create checkout session |
| `GET/PATCH /api/acp/checkout/[id]` | ACP | Get/update session |
| `POST /api/acp/checkout/[id]/complete` | ACP | Complete with Stripe token |
| `GET /api/products/feed.json` | — | Existující feed (lidský formát) |
| `GET /api/ucp/rest/orders/[id]` | UCP | Order status |
| `GET /api/acp/orders/[id]` | ACP | Order status |
| `POST /api/webhooks/saleor` | — | Saleor webhook handler (order events) |
| `POST /mcp` | MCP | 12 tools (7 read-only + 5 checkout) |

### Env variables (protocols)

```env
ACP_ENABLED=false                    # Zapnout ACP endpointy
ACP_API_KEY=                         # API klíč pro OpenAI
UCP_ENABLED=false                    # Zapnout UCP endpointy
UCP_VERSION=2026-01-23               # Verze UCP spec
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

| Vrstva | Cache | Revalidace |
|--------|-------|------------|
| Product/category pages | ISR 5 min | Webhook + `cacheTag` |
| Sitemap | `next.revalidate: 3600` | Automaticky po 1h |
| Product feed | `Cache-Control: max-age=3600` | Automaticky po 1h |
| llms.txt | `Cache-Control: max-age=86400` | Automaticky po 24h |
| MCP tools | Žádný cache | Real-time |
| Cart/checkout | `cache: "no-cache"` | Vždy live |

### Branding — co vyplnit pro nového klienta

V `src/config/brand.ts`:
```ts
siteName, organizationName, defaultBrand  // Název obchodu
tagline, description                      // Popisky
logoUrl, contactPhone, contactEmail       // Pro structured data
social.twitter, social.instagram, social.facebook  // Sociální sítě
titleTemplate                             // "%s | Název Obchodu"
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
