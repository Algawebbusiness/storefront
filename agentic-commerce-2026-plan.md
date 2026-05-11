# Plán implementace: Agentic Commerce 2026

> Roadmapa pro upgrade `storefront` šablony na úroveň **Stripe Sessions 2026** + **UCP `2026-04-08`**.
> Doplňuje (nenahrazuje) `saleor-agent-first-prd.md`, který popisuje původní implementaci pro UCP `2026-01-23`.
>
> **Vztah dokumentů:**
>
> - `saleor-agent-first-prd.md` — PRD původní agent-first vrstvy (UCP 2026-01-23, ACP, MCP, OAuth2). Stále platí jako reference na implementační detaily existujícího kódu.
> - `agentic-commerce-2026-plan.md` (tento soubor) — co se mění a přidává v 2026 vlně.
> - `CLAUDE.md` — globální projektový kontext, neměnit kvůli tomuto plánu (pouze odkaz).

---

## Obsah

1. [Jak používat tento plán](#jak-používat-tento-plán)
2. [Mapa fází a závislosti](#mapa-fází-a-závislosti)
3. [Pre-flight checklist](#pre-flight-checklist)
4. [Otevřené otázky](#otevřené-otázky)
5. [Fáze A — UCP 2026-04-08 parita & foundation](#fáze-a--ucp-2026-04-08-parita--foundation)
6. [Fáze B — Agent identity & trust layer](#fáze-b--agent-identity--trust-layer)
7. [Fáze C — Post-order & multi-payment handlers](#fáze-c--post-order--multi-payment-handlers)
8. [Fáze D — Czech moat](#fáze-d--czech-moat)
9. [Fáze E — Produktizace](#fáze-e--produktizace)
10. [Cross-cutting (testy, docs, migrace)](#cross-cutting)
11. [Stav implementace](#stav-implementace)

---

## Jak používat tento plán

- **5 fází (A–E), každá 10 kroků.**
- Kroky v rámci fáze jsou **obvykle lineární** (krok N+1 staví na N). Závislosti jsou explicitně uvedené v každém kroku.
- Mezi fázemi:
  - **A je foundation** — nutné dokončit před vším ostatním.
  - **B a C** mohou běžet paralelně po A.
  - **D čeká na B i C.**
  - **E čeká na A–D.**
- **Každý krok = jedna AI session.** Každý blok obsahuje cíl, soubory, klíčové implementační detaily/schémata, acceptance criteria a notes — tolik, aby AI agent mohl krok převzít a dokončit bez další analýzy.
- **Po dokončení kroku** přidej řádek do sekce `## Stav implementace` na konci dokumentu (datum, krok, commit hash).
- **Před každou fází** přečti pre-flight checklist na začátku fáze (pokud existuje) — některé fáze vyžadují rozhodnutí, která by měla být učiněna lidmi, ne AI.

### Konvence v plánu

- `path/to/file.ts` — soubor v repu (relativní k root). Nový soubor je označen "(nový)".
- `BLOCK` — env var.
- `Capability` — UCP capability ID.
- `Handler` — UCP payment handler ID (např. `com.stripe.shared_payment_token`).
- ✅ existuje, ⚠️ částečně, ❌ chybí.

---

## Mapa fází a závislosti

```
                  ┌──────────────────────────────┐
                  │ Fáze A: UCP 2026-04-08       │
                  │ parita & foundation          │
                  │ (10 kroků, ~2 týdny)         │
                  └─────────┬────────────────────┘
                            │
                  ┌─────────┴─────────┐
                  ▼                   ▼
   ┌───────────────────────┐   ┌──────────────────────────┐
   │ Fáze B: Agent         │   │ Fáze C: Post-order &     │
   │ identity & trust      │   │ multi-payment handlers   │
   │ (10 kroků, ~3 týdny)  │   │ (10 kroků, ~2 týdny)     │
   └───────────┬───────────┘   └──────────┬───────────────┘
               │                          │
               └──────────┬───────────────┘
                          ▼
                ┌──────────────────────┐
                │ Fáze D: Czech moat   │
                │ (10 kroků, ~3 týdny) │
                └─────────┬────────────┘
                          ▼
                ┌──────────────────────┐
                │ Fáze E: Produktizace │
                │ (10 kroků, ~4 týdny) │
                └──────────────────────┘
```

**Kritická cesta:** A → B → D → E (~12 týdnů). Fáze C může běžet paralelně k B a šetřit ~2 týdny.

**Detailní závislosti mezi kroky napříč fázemi:**

| Krok                             | Vyžaduje                                             |
| -------------------------------- | ---------------------------------------------------- |
| B3 (signed request verification) | A1 (signing keys)                                    |
| B7 (OAuth bind agent identity)   | B2 (Agent registry)                                  |
| C7 (Link Agent Wallet)           | C6 (multi-handler refactor)                          |
| D1, D2 (Comgate, GoPay)          | C6 (multi-handler refactor)                          |
| D3 (Zásilkovna fulfillment)      | A4 (cart capability)                                 |
| D5 (IČO/DIČ eligibility)         | C4 (eligibility framework)                           |
| E1 (Payload control panel)       | B2 (Agent registry) + C6                             |
| E5 (Travel/services slots)       | A2 (UCP version bump) + plug-in arch (v E5 samotném) |

---

## Pre-flight checklist

Před zahájením A1 ověř:

- [ ] Read `saleor-agent-first-prd.md` (kontext UCP 2026-01-23 implementace).
- [ ] Read `AGENTS.md` (architektura).
- [ ] Read `src/lib/protocols/` (současné UCP/ACP/shared) — strukturu už znáš z analýzy.
- [ ] Confirmuj přístup k Saleor sandboxu (`https://saleor-core.sliplane.app/graphql/`).
- [ ] Rozhodni signing key storage strategii (env vs Payload tenant config) — viz [Otevřené otázky](#otevřené-otázky).
- [ ] Rozhodni Agent registry storage (env-based vs Payload `Agents` collection) — viz [Otevřené otázky](#otevřené-otázky).
- [ ] Aktuální stav UCP profilu: `version: 2026-01-23`, `signing_keys: []`, capabilities: checkout/fulfillment/discount.
- [ ] Známý bug: profile-builder odkazuje na `${baseUrl}/api/ucp/mcp`, realný MCP endpoint je `${baseUrl}/mcp`. Bude opraven v A9.

---

## Otevřené otázky

Tyto otázky **nemusí** blokovat A1, ale ovlivňují implementaci pozdějších kroků. Doporučuji rozhodnout před B nebo D.

| Otázka                                                                          | Vliv   | Default doporučení                                                                                 |
| ------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------------- |
| Signing key storage: env vs Payload tenant?                                     | A1, B3 | **Env per deployment** pro start. Payload tenant per-client v Phase E.                             |
| Agent registry: env (`AGENT_REGISTRY` JSON) vs Payload collection?              | B1, B2 | **Payload collection** — lepší multi-tenancy, UI, audit. Env je fallback pro projekty bez Payload. |
| MPP / streaming payments — pilotovat 2026 nebo počkat?                          | C9     | **Skeleton v C9, plný pilot v E7**, jen pro digital/SaaS klienty.                                  |
| Stablecoin handler — declarative (Stripe processes) nebo full custom?           | C8     | **Declarative** — Stripe to processuje, my jen deklarujeme support.                                |
| Travel/services UCP capabilities — plug-in slot v šabloně, nebo separátní fork? | E5     | **Plug-in slot** — zachovat šablonu jako "commerce template", ne jen "e-shop".                     |
| Které agent platformy v default `accepted_platforms`?                           | B8     | OpenAI, Google (Gemini), Anthropic, Microsoft Copilot. Defaultně ✅, opt-out per tenant.           |
| Migration `AGENT_API_KEYS` → Agent registry — backward-compat?                  | B9     | **Dual-mode 6 měsíců**: oba fungují, deprecation log. Po 6M: registry only.                        |

---

# Fáze A — UCP 2026-04-08 parita & foundation

**Cíl:** Vyrovnat současnou UCP implementaci na nejnovější spec (`2026-04-08`), postavit signing infrastructure pro Phase B+, opravit blokující bug v MCP endpointu.

**Trvání:** ~2 týdny.

**Výstup fáze:** Šablona deklaruje nejnovější UCP capabilities (cart, catalog), podepisuje odpovědi ed25519 klíčem, přijímá `intent` field, validuje totals podle 2026-04-08 kontraktu. Žádný breaking change pro existující klienty.

---

## A1. Generate ed25519 signing keypair + env loader

**Cíl:** Mít privátní/veřejný klíč pro podepisování UCP/ACP odpovědí. Vytvořit utilities pro načítání klíčů z env.

**Závislosti:** Žádné. **První krok celého plánu.**

**Soubory:**

- `scripts/generate-signing-keys.mjs` (nový)
- `src/lib/protocols/shared/signing.ts` (nový)
- `.env.example` (update — přidat 3 nové vars)

**Implementace:**

Skript `generate-signing-keys.mjs` použije Node `crypto.subtle` (Web Crypto API):

```js
// scripts/generate-signing-keys.mjs
import { webcrypto as crypto } from "node:crypto";

const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const privateKey = await crypto.subtle.exportKey("raw", keyPair.privateKey);
const publicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);

const toBase64 = (buf) => Buffer.from(buf).toString("base64");
console.log(`UCP_SIGNING_PRIVATE_KEY="${toBase64(privateKey)}"`);
console.log(`UCP_SIGNING_PUBLIC_KEY="${toBase64(publicKey)}"`);
console.log(`UCP_SIGNING_KEY_ID="algaweb-${new Date().toISOString().slice(0, 7)}"`);
```

`signing.ts` exportuje:

```ts
export async function getSigningKey(): Promise<{
	privateKey: CryptoKey;
	publicKey: CryptoKey;
	keyId: string;
}>;

export async function signPayload(payload: string | object): Promise<string>; // returns base64 signature
export async function verifySignature(
	payload: string | object,
	signature: string,
	publicKey: CryptoKey,
): Promise<boolean>;
```

Edge runtime kompatibilita: použít `globalThis.crypto.subtle`, ne Node `crypto.createSign`.

**Acceptance:**

- [ ] `node scripts/generate-signing-keys.mjs` vypíše 3 env řádky.
- [ ] `getSigningKey()` v dev modu bez env vars vygeneruje in-memory keypair s `console.warn`.
- [ ] `getSigningKey()` v prod modu bez env throwne s jasnou chybou.
- [ ] `signPayload({foo:"bar"})` vrátí base64 string délky 88.
- [ ] `verifySignature(...)` na valid signature vrátí `true`, na corrupted `false`.
- [ ] Unit testy pokrývají sign/verify roundtrip.

**Notes:**

- ed25519 je v `crypto.subtle` napříč Node 20+ a moderními runtimes (Vercel Edge, Cloudflare Workers).
- Klíče jsou 32B raw, base64-encoded v env. Žádné PEM, žádné JWK (pro start).

---

## A2. Bump UCP_VERSION → 2026-04-08, update profile schema URLs

**Cíl:** Přepnout profil na nejnovější UCP spec a aktualizovat všechny schema URL referencí.

**Závislosti:** A1 (signing keys budou potřeba v A3).

**Soubory:**

- `src/lib/protocols/ucp/profile-builder.ts`
- `src/lib/protocols/ucp/types.ts` (možná update kvůli novým schema fieldům)
- `src/lib/protocols/ucp/capabilities.ts`
- `.env.example`

**Implementace:**

```ts
const UCP_VERSION = process.env.UCP_VERSION || "2026-04-08";
const UCP_SPEC_BASE = `https://ucp.dev/${UCP_VERSION}/specification`;
const UCP_SCHEMA_BASE = `https://ucp.dev/${UCP_VERSION}`;
```

Audit `types.ts` proti https://ucp.dev/2026-04-08/specification/overview — přidat nová pole, která jsou v 2026-04-08:

- `UcpProfile.signing_keys[]`: každý klíč má `kid`, `algorithm` (`"ed25519"`), `public_key` (base64).
- `UcpServiceBinding.error_handling`: nový field per service.

`capabilities.ts` — refaktorovat aby capability definice byly enumerated objekty, ne strings (připraví terén pro A4–A5).

**Acceptance:**

- [ ] `GET /.well-known/ucp` vrací `version: "2026-04-08"`.
- [ ] Všechna schema URL pointují na `https://ucp.dev/2026-04-08/...`.
- [ ] Existující ACP/UCP testy pass.
- [ ] Validace profilu proti UCP `2026-04-08` JSON schema (manual via curl/Postman).

**Notes:**

- Nezvyšuj verzi v `package.json` ani v ACP — ACP má vlastní verzování.
- Pokud UCP `types.ts` nesouhlasí s realným schema z `https://ucp.dev/2026-04-08/schemas/...`, otevři issue + úprav locally; nesnaž se downloadovat schema.

---

## A3. Implement signed response middleware

**Cíl:** Každá UCP odpověď (a volitelně ACP) je podepsaná, agent může ověřit autenticity přes `signing_keys` v profilu.

**Závislosti:** A1 (signing keys), A2 (profile vystavuje `signing_keys`).

**Soubory:**

- `src/lib/protocols/shared/signing.ts` (rozšíření)
- `src/lib/protocols/shared/response.ts` (nový — wrapper na signed response)
- `src/app/api/ucp/rest/checkout-sessions/route.ts` (a sub-routes) — použij wrapper
- `src/app/api/acp/checkout/route.ts` — použij wrapper
- `src/app/.well-known/ucp/route.ts` — publikuj `signing_keys` v profilu

**Implementace:**

```ts
// shared/response.ts
export async function signedResponse<T>(data: T, init?: ResponseInit): Promise<Response> {
	const body = JSON.stringify(data);
	const signature = await signPayload(body);
	const { keyId } = await getSigningKey();
	const headers = new Headers(init?.headers);
	headers.set("Content-Type", "application/json");
	headers.set("UCP-Signature", `keyid="${keyId}",alg="ed25519",sig="${signature}"`);
	return new Response(body, { ...init, headers });
}
```

Profil v `/.well-known/ucp` musí vystavit veřejný klíč:

```json
{
	"ucp": { "...": "..." },
	"signing_keys": [
		{
			"kid": "algaweb-2026-05",
			"algorithm": "ed25519",
			"public_key": "base64encoded32bytes",
			"created_at": "2026-05-01T00:00:00Z"
		}
	]
}
```

Header convention `UCP-Signature` — formát viz UCP spec 2026-04-08; pokud spec přesně nedefinuje, použij RFC 9421 (HTTP Message Signatures) styl.

**Acceptance:**

- [ ] Každá `/api/ucp/rest/*` odpověď má header `UCP-Signature`.
- [ ] `/.well-known/ucp` obsahuje neprázdný `signing_keys[]` array.
- [ ] Test simuluje agent: fetch endpoint → extract signature → verify proti public key → musí být valid.
- [ ] `verifySignature` na corrupted body vrátí `false`.

**Notes:**

- ACP nemá v `2026-04-08` ekvivalent `UCP-Signature`. Volitelně použij stejný header pro ACP — agenti to mohou ignorovat, ale buduje to konzistenci.
- **Nepodepisuj cache responses** (sitemap, llms.txt). Jen agent-facing endpointy.

---

## A4. Add `dev.ucp.shopping.cart` capability + REST endpoint

**Cíl:** Vystavit cart capability — agent může budovat košík před `complete`. Mapuje na Saleor `Checkout` ve stavu před `checkoutComplete`.

**Závislosti:** A2 (UCP version bump), A3 (signed response).

**Soubory:**

- `src/lib/protocols/ucp/capabilities.ts` (přidat `CART`)
- `src/lib/protocols/ucp/profile-builder.ts` (deklarovat cart cap)
- `src/lib/protocols/shared/cart-mapper.ts` (nový — Saleor checkout ↔ UCP cart)
- `src/app/api/ucp/rest/carts/route.ts` (nový, POST = create cart)
- `src/app/api/ucp/rest/carts/[id]/route.ts` (nový, GET/PATCH/DELETE)
- `src/app/api/ucp/rest/carts/[id]/lines/route.ts` (nový, POST = add line)
- `src/app/api/ucp/rest/carts/[id]/lines/[lineId]/route.ts` (nový, PATCH/DELETE)

**Implementace:**

UCP cart shape (per 2026-04-08):

```ts
type UcpCart = {
	id: string;
	currency: string; // mandatory
	lines: UcpCartLine[];
	totals: UcpTotals; // subtotal, tax, shipping, discount, total
	applied_discounts?: UcpAppliedDiscount[];
	warnings?: UcpWarning[]; // např. "stock low", "price changed since last view"
	expires_at?: string; // ISO
};
```

Saleor mapping:

- UCP cart `id` ↔ Saleor `Checkout.id` (toto je Saleor checkout PŘED `complete`).
- UCP `lines[].sku` ↔ Saleor `CheckoutLine.variant.sku`.
- UCP `lines[].quantity` ↔ Saleor `CheckoutLine.quantity`.
- UCP `totals.subtotal_cents` ↔ Saleor `Checkout.subtotalPrice.gross.amount` (× 100, rounded).
- UCP `warnings[]` z Saleor `Checkout.problems[]` (UNAVAILABLE_VARIANT, INSUFFICIENT_STOCK, atd.).

Endpointy:

```
POST   /api/ucp/rest/carts                      → create empty cart
GET    /api/ucp/rest/carts/:id                  → read cart
PATCH  /api/ucp/rest/carts/:id                  → update metadata (intent, notes)
DELETE /api/ucp/rest/carts/:id                  → cancel cart
POST   /api/ucp/rest/carts/:id/lines            → add line {sku, quantity}
PATCH  /api/ucp/rest/carts/:id/lines/:lineId    → update quantity
DELETE /api/ucp/rest/carts/:id/lines/:lineId    → remove line
```

Saleor mutations: `checkoutCreate`, `checkoutLinesAdd`, `checkoutLinesUpdate`, `checkoutLinesDelete`. Použij `saleorQuery` pattern z `saleor-client.ts`.

**Acceptance:**

- [ ] Profil v `/.well-known/ucp` deklaruje `dev.ucp.shopping.cart` capability.
- [ ] `POST /api/ucp/rest/carts` vrátí cart s `id` a prázdným `lines[]`.
- [ ] `POST /api/ucp/rest/carts/:id/lines` přidá produkt → cart `totals` se aktualizují.
- [ ] Currency je v cart top-level mandatory.
- [ ] Reagentní integration test: vytvoř cart → přidej 2 produkty → ověř totals → smaž 1 → ověř totals.
- [ ] Existující checkout flow (`/api/ucp/rest/checkout-sessions`) **stále funguje** — cart je nezávislá vrstva, checkout-session `complete` zůstává konec flow.

**Notes:**

- UCP cart ≠ UCP checkout-session. Cart je "rozpracovaný košík", checkout-session je "připravený k platbě s adresou + doručením". Tradiční flow: cart → konvertuj na checkout-session → complete.
- Saleor model: jeden `Checkout` objekt prochází oběma fázemi. Mapper musí rozhodnout, které fields jsou "cart fields" a které "checkout-session fields".

---

## A5. Add `dev.ucp.shopping.catalog` capability + REST endpoint

**Cíl:** Vystavit catalog capability — agent může hledat produkty, lookup detail. Dnes to dělá MCP `search_products`, ale UCP capability chybí.

**Závislosti:** A2.

**Soubory:**

- `src/lib/protocols/ucp/capabilities.ts` (přidat `CATALOG`)
- `src/lib/protocols/ucp/profile-builder.ts`
- `src/app/api/ucp/rest/catalog/search/route.ts` (nový)
- `src/app/api/ucp/rest/catalog/products/[slug]/route.ts` (nový)
- `src/app/api/ucp/rest/catalog/categories/route.ts` (nový)
- `src/lib/protocols/shared/catalog-mapper.ts` (nový — Saleor → UCP catalog item)

**Implementace:**

```
GET  /api/ucp/rest/catalog/search?q=&category=&min_price=&max_price=&page=&limit=
GET  /api/ucp/rest/catalog/products/:slug
GET  /api/ucp/rest/catalog/categories
```

UCP product shape (zarovnat se schema 2026-04-08):

```ts
type UcpCatalogItem = {
	id: string;
	sku: string;
	title: string;
	description: string;
	url: string;
	images: { url: string; alt?: string }[];
	price: { amount_cents: number; currency: string };
	availability: "in_stock" | "out_of_stock" | "preorder";
	category?: string;
	attributes: Record<string, string | number | boolean>; // agent-friendly metadata
	variants?: UcpCatalogItem[];
};
```

**Důležité — agent-friendly attributes:** Nejen `title` a `description`. Mapuj Saleor product attributes do `attributes` objektu. Pokud má produkt v Saleoru attribute "origin: Ethiopia" a "process: natural", musí se to objevit ve `attributes` jako structured data, ne jen text v description.

```ts
// catalog-mapper.ts
attributes: Object.fromEntries(
	product.attributes.map((a) => [a.attribute.slug, a.values.map((v) => v.name).join(", ")]),
);
```

**Acceptance:**

- [ ] `GET /api/ucp/rest/catalog/search?q=káva` vrátí seznam produktů s pageinací.
- [ ] Každý item obsahuje `attributes` s structured key-value (ne jen description).
- [ ] `GET /api/ucp/rest/catalog/products/some-slug` vrátí kompletní detail s variantami.
- [ ] Profil deklaruje `dev.ucp.shopping.catalog` capability.

**Notes:**

- **Nezahazuj MCP `search_products` tool** — MCP transport je v UCP profilu deklarován vedle REST. Oba musí pracovat.
- Performance: cache `/catalog/search` na 5 minut (stejné TTL jako product pages). Použij `next.revalidate: 300`.

---

## A6. Add `available_payment_instruments` to handler config

**Cíl:** Profil vystavuje, jaké platební instrumenty jsou pro daný handler dostupné. UCP 2026-04-08 to vyžaduje.

**Závislosti:** A2.

**Soubory:**

- `src/lib/protocols/ucp/types.ts` (rozšířit `UcpPaymentHandler`)
- `src/lib/protocols/ucp/profile-builder.ts`

**Implementace:**

```ts
type UcpPaymentHandler = {
	id: string;
	version: string;
	config: {
		publishable_key?: string;
		available_payment_instruments: UcpPaymentInstrument[];
	};
};

type UcpPaymentInstrument =
	| "card"
	| "card.visa"
	| "card.mastercard"
	| "card.amex"
	| "sepa_debit"
	| "klarna"
	| "affirm"
	| "paypal"
	| "apple_pay"
	| "google_pay"
	| "stablecoin.usdc"
	| "stablecoin.usdg"
	| "wallet.link"
	| string; // open enum
```

V profilu pro Stripe SPT handler:

```ts
"com.stripe.shared_payment_token": [{
  id: "stripe_spt",
  version: UCP_VERSION,
  config: {
    publishable_key: stripeKey,
    available_payment_instruments: [
      "card", "apple_pay", "google_pay",
      "klarna", "affirm",  // pokud zapnuto v Stripe accountu
    ],
  },
}]
```

Detekce dostupných instruments — možnosti:

1. **Statické per env** (rychlé, env var `STRIPE_AVAILABLE_INSTRUMENTS=card,apple_pay,...`).
2. **Dynamické přes Stripe API** (`paymentMethods.list`) — komplexnější, vyžaduje server-side Stripe secret key.

Pro start: **statické**. Dynamické v E1 (control panel).

**Acceptance:**

- [ ] Profil obsahuje `available_payment_instruments` pro každý deklarovaný handler.
- [ ] Default obsahuje minimum: `["card"]`.
- [ ] Env override `STRIPE_AVAILABLE_INSTRUMENTS=card,sepa_debit` funguje.

---

## A7. Implement `intent` field handling

**Cíl:** Agent posílá `intent` field v context (např. _"authentic Ethiopian coffee for filter brewing"_); šablona ho přijímá, ukládá do checkout metadata, vrací v cart/order responses.

**Závislosti:** A4 (cart endpoints).

**Soubory:**

- `src/lib/protocols/shared/types.ts` (rozšíření common types)
- `src/lib/protocols/shared/cart-mapper.ts`
- `src/lib/protocols/shared/checkout-mapper.ts`
- `src/app/api/ucp/rest/carts/route.ts`, `[id]/route.ts` (POST/PATCH přijímá `intent`)
- `src/app/api/ucp/rest/checkout-sessions/route.ts`

**Implementace:**

UCP request body může mít `context`:

```json
{
  "lines": [...],
  "context": {
    "intent": "authentic Ethiopian honey-process coffee for v60",
    "buyer_preferences": { "max_age_days": 14, "origin_priority": ["ethiopia", "yemen"] },
    "session_id": "agent-session-123"
  }
}
```

Strategie ukládání:

- Saleor `Checkout` má `metadata` (key-value array). Persistuj `intent` jako `metadata[intent]`.
- `buyer_preferences` JSON-stringify do `metadata[buyer_preferences]`.
- `context.session_id` jako `metadata[agent_session_id]` — užitečné pro audit/log.

Při GET cart response vrať `context` zpět:

```ts
return {
	id,
	currency,
	lines,
	totals,
	context: {
		intent: metadata.intent,
		buyer_preferences: JSON.parse(metadata.buyer_preferences || "{}"),
	},
};
```

**Acceptance:**

- [ ] `POST /api/ucp/rest/carts` body s `context.intent: "..."` uloží intent.
- [ ] `GET /api/ucp/rest/carts/:id` vrátí intent zpět v `context`.
- [ ] `intent` je viditelný v Saleor Dashboard checkout metadata.
- [ ] Order webhook (po `complete`) propaguje intent z checkout do order metadata.

**Notes:**

- **Intent NEPOUŽÍVÁ pro filtraci produktů automaticky** v této fázi. Je to channel pro agent → merchant signal. Pokročilá AI-driven product matching by byla samostatný projekt (mimo plán).
- Limit length: 500 znaků pro `intent`, 2000 pro stringified `buyer_preferences`. Větší → 400 Bad Request.

---

## A8. Update totals/currency contract per 2026-04-08

**Cíl:** UCP 2026-04-08 vyžaduje currency mandatory na order top-level a standardizuje totals shape. Audit + fix existující ACP/UCP order/checkout responses.

**Závislosti:** A2.

**Soubory:**

- `src/lib/protocols/shared/order-mapper.ts`
- `src/lib/protocols/shared/checkout-mapper.ts`
- `src/lib/protocols/shared/types.ts` (`UcpTotals`, `UcpOrder`)
- `src/lib/protocols/shared/money.ts`

**Implementace:**

Standardizovaný `UcpTotals` shape (v 2026-04-08):

```ts
type UcpTotals = {
	currency: string; // ISO 4217, mandatory
	subtotal_cents: number; // before discounts, taxes, shipping
	discount_cents: number; // total discount applied
	shipping_cents: number; // shipping cost
	tax_cents: number; // total tax
	total_cents: number; // final amount payable
	// breakdown[] is optional — per-line tax/discount detail
	breakdown?: UcpTotalsBreakdown[];
};
```

Audit:

- `order-mapper.ts` aktuálně vrací totals — zkontroluj že má **vše výše uvedené pole** a currency je ve **správném ISO 4217 formátu** (např. `"CZK"`, ne `"czk"`).
- Saleor totals jsou v `Checkout.totalPrice.gross.amount` (decimální). `toMinorUnits()` z `money.ts` musí produkovat integery.

**Acceptance:**

- [ ] `GET /api/ucp/rest/orders/:id` response má `currency` na order top-level (ne jen v totals).
- [ ] Všechny totals fieldy jsou integer cents.
- [ ] Schema validace: response prochází přes UCP 2026-04-08 totals JSON schema.
- [ ] Existující testy `money.test.ts` rozšířené o JPY (zero-decimal), KWD (3-decimal) edge cases.

**Notes:**

- **JPY a další zero-decimal** currencies: Saleor stále vrací decimal, ale "100 JPY" = `100.00` v Saleoru = `100` v cents. `toMinorUnits()` musí zohlednit `currency` parametr a multiplier (100, 10, 1000, atd.).

---

## A9. Fix `/api/ucp/mcp` endpoint mismatch

**Cíl:** Profil `profile-builder.ts` deklaruje MCP transport endpoint `${baseUrl}/api/ucp/mcp`, ale realný route je `${baseUrl}/mcp`. Agent → 404. **Bug.**

**Závislosti:** A2 (změny v profile-builderu už proběhly, sjednotit teď).

**Soubory:**

- `src/lib/protocols/ucp/profile-builder.ts` (změnit endpoint)

**ALTERNATIVNĚ:**

- `src/app/api/ucp/mcp/route.ts` (nový — proxy/redirect na `/mcp`)

**Implementace (Option A — preferovaná):**

Změň profile-builder:

```ts
// před:
endpoint: `${baseUrl}/api/ucp/mcp`,
// po:
endpoint: `${baseUrl}/mcp`,
```

**Implementace (Option B — pokud chceš zachovat URL hierarchii):**

Vytvoř `src/app/api/ucp/mcp/route.ts` jako proxy (přesměruje request na existující `/mcp` handler).

**Doporučení:** **Option A**. Méně kódu, méně místa pro chyby. URL hierarchie není deal breaker — UCP profil může pointnout kamkoli.

**Acceptance:**

- [ ] `curl -X POST $(jq -r .ucp.services."dev.ucp.shopping"[1].endpoint /.well-known/ucp)` projde JSON-RPC initialize.
- [ ] MCP Inspector se připojí přes URL z profilu.
- [ ] Žádný `/api/ucp/mcp` 404 v logu.

---

## A10. Update PRD + tests + docs

**Cíl:** Dokumentační uzávěrka fáze. PRD musí odpovídat realitě, tests pokrývají A1–A9.

**Závislosti:** A1–A9.

**Soubory:**

- `saleor-agent-first-prd.md` (update — přidat sekci "2026-04-08 deltas")
- `CLAUDE.md` (update — UCP_VERSION, krátký pointer na tento plán)
- `AGENTS.md` (update — nová capability, signing, intent field)
- `__tests__/protocols/` (rozšíření testů)
- Potenciálně `skills/saleor-paper-storefront/rules/protocols.md` (nový skill rule)

**Acceptance:**

- [ ] PRD odráží UCP 2026-04-08 reality.
- [ ] Test coverage: ed25519 sign/verify (≥3 testy), cart roundtrip (≥5 testů), catalog search (≥3 testů), totals invariants (≥5 testů).
- [ ] `pnpm exec tsc --noEmit` clean.
- [ ] `pnpm test` 100% pass.
- [ ] CLAUDE.md má 1–2 řádky pointing na `agentic-commerce-2026-plan.md`.

**Notes:**

- **PRD aktualizace je deltový**: nepřepisuj celý PRD, přidej sekci "Změny v UCP 2026-04-08 (květen 2026)" na konec.

---

# Fáze B — Agent identity & trust layer

**Cíl:** Posunout agent autentizaci z primitivního `AGENT_API_KEYS` (bearer string list) na strukturovaný registry s identitou, scope, audit, signed requesty a abuse detection. **Toto je hlavní Algaweb moat.**

**Trvání:** ~3 týdny.

**Výstup fáze:** Každý agent call má identifikovaný subject, podepsaný request, zaznamenaný audit log, vynucené spending caps a rate limits. Klient vidí v Payload Admin, kdo a co u jeho e-shopu nakupoval.

---

## B1. Design Agent registry schema

**Cíl:** Rozhodnout shape Agent identity, mezi env a Payload variantou. Vytvořit type definition + dokumentaci, ne kód.

**Závislosti:** Pre-flight rozhodnutí (env vs Payload). Default doporučení: **Payload collection**.

**Soubory:**

- `src/lib/protocols/shared/agent-registry-types.ts` (nový — types)
- `docs/agent-registry-design.md` (volitelně, nový)

**Implementace:**

```ts
type AgentIdentity = {
	id: string; // unique slug, např. "openai-chatgpt-prod"
	display_name: string;
	platform: "openai" | "google" | "anthropic" | "microsoft" | "custom";
	status: "active" | "suspended" | "revoked";
	public_key: string; // base64 ed25519 32B
	scope: AgentScope[]; // jaké akce agent smí
	spending_limit: {
		per_session_cents: number | null;
		per_day_cents: number | null;
		per_month_cents: number | null;
	};
	rate_limit: {
		requests_per_minute: number;
		sessions_per_day: number;
	};
	contact_email?: string; // pro abuse reports
	notes?: string;
	created_at: string;
	updated_at: string;
};

type AgentScope =
	| "catalog.read"
	| "cart.create"
	| "cart.update"
	| "checkout.create"
	| "checkout.complete"
	| "order.read"
	| "order.return"
	| "customer.read"
	| "customer.update"; // jen s OAuth user consentem
```

Storage strategie:

- **Primary: Payload collection `Agents`** (per-tenant, multi-tenancy plugin).
- **Fallback: env JSON** (`AGENT_REGISTRY_JSON` — pole AgentIdentity objektů). Použito když `PAYLOAD_API_URL` není nastaveno.
- **Loader** (B2): unifikovaný — `getAgentById(id)` zkusí Payload, pak env.

**Acceptance:**

- [ ] Type definition v repu.
- [ ] Dokumentace popisuje shape, scope enumy, lifecycle.
- [ ] Approval check-in s lidským reviewerem (Jirka) — schéma je správně před B2.

---

## B2. Implement `Agents` Payload collection (s fallback na env)

**Cíl:** Vytvořit Payload collection + storefront-side loader.

**Závislosti:** B1.

**Soubory:**

- `payload-collections/Agents.ts` (nový — Payload collection definition; půjde do separátního Payload repa, ale v tomto repu jako reference/template)
- `src/lib/protocols/shared/agent-registry.ts` (nový — loader)
- `src/lib/payload/queries.ts` (rozšířit o `getAgents()`, `getAgentById()`)
- `.env.example` (přidat `AGENT_REGISTRY_JSON` fallback)

**Implementace:**

`agent-registry.ts`:

```ts
export async function getAgentById(id: string): Promise<AgentIdentity | null> {
	// 1. Try Payload
	if (process.env.PAYLOAD_API_URL) {
		const fromPayload = await payloadClient.findOne("agents", { id });
		if (fromPayload) return fromPayload;
	}
	// 2. Fallback to env JSON
	const envRegistry = parseEnvRegistry(process.env.AGENT_REGISTRY_JSON);
	return envRegistry.find((a) => a.id === id) ?? null;
}

export async function listActiveAgents(): Promise<AgentIdentity[]>;
```

Cache strategie:

- Payload: cache 5 minut (agenti se nemění často).
- Env: parsed once at boot.

Payload collection skeleton (v `payload-collections/Agents.ts`):

```ts
export const Agents: CollectionConfig = {
	slug: "agents",
	admin: {
		useAsTitle: "display_name",
		description: "AI agenti, kteří mohou nakupovat z tohoto e-shopu",
	},
	fields: [
		{ name: "id", type: "text", required: true, unique: true },
		{ name: "display_name", type: "text", required: true },
		{
			name: "platform",
			type: "select",
			options: ["openai", "google", "anthropic", "microsoft", "custom"],
			required: true,
		},
		{ name: "status", type: "select", options: ["active", "suspended", "revoked"], defaultValue: "active" },
		{ name: "public_key", type: "text", required: true },
		{
			name: "scope",
			type: "select",
			hasMany: true,
			options: [
				/* viz B1 */
			],
		},
		{
			name: "spending_limit",
			type: "group",
			fields: [
				/* per_session_cents, per_day_cents, per_month_cents */
			],
		},
		{
			name: "rate_limit",
			type: "group",
			fields: [
				/* requests_per_minute, sessions_per_day */
			],
		},
		{ name: "contact_email", type: "email" },
		{ name: "notes", type: "textarea" },
	],
};
```

**Acceptance:**

- [ ] `getAgentById("openai-chatgpt-prod")` vrátí AgentIdentity z Payload (pokud Payload běží) nebo z env (fallback).
- [ ] `listActiveAgents()` filtruje `status: "active"`.
- [ ] Type-safe loader (žádné `any`).
- [ ] Test pokrývá: Payload hit, Payload miss → env hit, oba miss → null.

---

## B3. Implement signed request verification middleware

**Cíl:** Příchozí UCP request má header `UCP-Signature`. Middleware ověří podpis proti `public_key` agenta. Pokud invalid → 401.

**Závislosti:** A1 (signing primitives), B2 (agent registry).

**Soubory:**

- `src/lib/protocols/shared/auth.ts` (rozšířit — přidat `verifyAgentRequest()`)
- `src/lib/protocols/shared/signing.ts` (rozšířit — `verifyDetached()`)
- Všechny `/api/ucp/rest/*` route files (přidat middleware call)

**Implementace:**

```ts
// auth.ts
export async function verifyAgentRequest(req: Request): Promise<
	| {
			agent: AgentIdentity;
			bodyText: string;
	  }
	| { error: string; status: number }
> {
	const signatureHeader = req.headers.get("UCP-Signature");
	const agentIdHeader = req.headers.get("UCP-Agent");

	if (!signatureHeader || !agentIdHeader) {
		// Fallback to AGENT_API_KEYS bearer (deprecated, viz B9)
		return legacyBearerAuth(req);
	}

	const agent = await getAgentById(agentIdHeader);
	if (!agent || agent.status !== "active") {
		return { error: "Unknown or inactive agent", status: 401 };
	}

	const bodyText = await req.text();
	const { keyId, signature } = parseSignatureHeader(signatureHeader);

	const valid = await verifyDetached(bodyText, signature, agent.public_key);
	if (!valid) return { error: "Invalid signature", status: 401 };

	return { agent, bodyText };
}
```

Použití v route:

```ts
export async function POST(req: NextRequest) {
	const auth = await verifyAgentRequest(req);
	if ("error" in auth) return new Response(auth.error, { status: auth.status });
	const { agent, bodyText } = auth;
	const body = JSON.parse(bodyText);
	// ... use agent.id, agent.scope to enforce permissions
}
```

**Acceptance:**

- [ ] Request bez `UCP-Signature` + bez `Authorization` → 401.
- [ ] Request s valid `UCP-Signature` + neznámým agent ID → 401.
- [ ] Request s valid agent ID + invalid signature → 401.
- [ ] Request s valid signature → 2xx, agent identity je dostupná v handleru.
- [ ] Existující `AGENT_API_KEYS` flow stále funguje (B9 řeší migraci).

**Notes:**

- Verifikuj **původní raw body**, ne JSON.parse výsledek. JSON normalization může změnit byte sequence.
- Replay attack mitigation: header `UCP-Timestamp` (UNIX millis), reject pokud > 5 min od now. Implementovat v B10.

---

## B4. Agent activity log

**Cíl:** Každý agent call zaznamenat — kdo, co, kdy, výsledek. Pro audit, abuse detection a klientův insight.

**Závislosti:** B3.

**Soubory:**

- `payload-collections/AgentActivity.ts` (nový)
- `src/lib/protocols/shared/agent-log.ts` (nový — logger)
- Všechny `/api/ucp/rest/*` route files (call `logAgentAction()` po response)

**Implementace:**

Payload collection `AgentActivity`:

```ts
{
  agent_id: string;
  action: string;          // např. "cart.create", "checkout.complete"
  scope: string;           // požadovaný scope
  resource_id?: string;    // např. cart_id, checkout_id
  request_summary?: string;// truncated body summary
  status: "success" | "denied" | "error";
  status_code: number;
  duration_ms: number;
  amount_cents?: number;   // pokud byl spojen s peněžním ekvivalentem
  ip?: string;
  user_agent?: string;
  created_at: string;
}
```

Logger:

```ts
// agent-log.ts
export async function logAgentAction(entry: Omit<AgentActivityEntry, "created_at">): Promise<void> {
	// 1. Try Payload
	// 2. Fallback to console.log structured (pickup by external log shipper)
}
```

Integration: middleware/wrapper kolem každého route handleru, který volá `logAgentAction()` po dokončení.

**Acceptance:**

- [ ] Po každém agent calls existuje záznam v `AgentActivity` (nebo console pokud Payload off).
- [ ] Záznam má `duration_ms` (start/end timing).
- [ ] Failed calls mají `status: "denied" | "error"` se status_code.
- [ ] Žádný PII v `request_summary` (filter card numbers, addresses, atd.).

**Notes:**

- **Performance:** logování fire-and-forget (`void logAgentAction(...)`). Agent response neblokovat na DB write.
- **Retention:** old logs (> 90 dní) archivovat. Implementační detail v E3.

---

## B5. Per-agent spending caps + rate limits

**Cíl:** Vynucování limitů z Agent registry. Překročení → 429.

**Závislosti:** B2 (registry), B4 (log pro counters).

**Soubory:**

- `src/lib/protocols/shared/limits.ts` (nový)
- Integrace v auth middleware z B3.

**Implementace:**

In-memory + persisted counter strategy:

- **Krátkodobé** (per minute): in-memory Map<agent_id, { count, windowStart }>. Reset každou minutu.
- **Středně dlouhé** (per hour, per day): Redis nebo Payload counter doc. Pokud Redis chybí → degradace na "best effort" with periodic sync z `AgentActivity` Payload.

```ts
export async function checkLimits(
	agent: AgentIdentity,
	requestedAmountCents?: number,
): Promise<{ allowed: true } | { allowed: false; reason: string; retry_after_s?: number }> {
	// 1. requests_per_minute (in-memory)
	// 2. sessions_per_day (Payload count of unique session_id today)
	// 3. spending_per_session_cents (cart total <= cap)
	// 4. spending_per_day_cents (sum of completed orders today)
	// 5. spending_per_month_cents (sum of completed orders this calendar month)
}
```

V auth middleware po `verifyAgentRequest`:

```ts
const limits = await checkLimits(agent, body.estimated_amount_cents);
if (!limits.allowed) {
	return new Response(JSON.stringify({ error: limits.reason }), {
		status: 429,
		headers: { "Retry-After": String(limits.retry_after_s ?? 60) },
	});
}
```

**Acceptance:**

- [ ] Agent s `rate_limit.requests_per_minute: 10` blokuje 11. request → 429.
- [ ] Agent s `spending_limit.per_day_cents: 50000` blokuje cart total > 500 CZK.
- [ ] Limit reset funguje (po minutě, po půlnoci).
- [ ] Agent bez limit (null values) je unlimited.

---

## B6. Approval flow for high-risk actions

**Cíl:** Některé akce (refund > X, order > Y, agent suspended → reactivation) vyžadují souhlas klienta. Vytvořit pending approvals + UI v Payload.

**Závislosti:** B2, B4.

**Soubory:**

- `payload-collections/AgentPendingApprovals.ts` (nový)
- `src/lib/protocols/shared/approvals.ts` (nový)
- `src/app/api/ucp/rest/checkout-sessions/[id]/complete/route.ts` (přidat approval check)

**Implementace:**

Pending approval:

```ts
{
  id: string;
  agent_id: string;
  action: string;             // "checkout.complete"
  resource_id: string;        // checkout/order ID
  amount_cents?: number;
  reason: string;             // proč to vyžaduje approval ("over per_session limit by 1500 CZK")
  status: "pending" | "approved" | "rejected" | "expired";
  expires_at: string;
  approved_by?: string;       // user ID
  approved_at?: string;
}
```

Trigger logic:

- Per-tenant config (Payload `Tenant` collection field): `approval_threshold_cents: number | null`.
- Pokud cart total > threshold → vytvoř pending approval, vrať agentovi `202 Accepted` s `approval_url`.
- Klient v Payload Admin vidí pending list, schválí/odmítne.
- Approved → checkout dokončí (background). Rejected → cart zrušen.

API:

```
POST /api/ucp/rest/checkout-sessions/:id/complete
  → 202 Accepted, body: { status: "pending_approval", approval_id, approval_expires_at }
GET  /api/ucp/rest/approvals/:id
  → status check (agent může pollovat)
```

**Acceptance:**

- [ ] Cart > threshold → 202 + approval ID.
- [ ] Klient schválí v Payload → checkout dokončí, agent dostane completion notification (webhook nebo poll).
- [ ] Expired approval → automaticky reject.
- [ ] Pod threshold → flow nezměněn (immediate complete).

**Notes:**

- **Notification klientovi**: emailově (Resend MCP) nebo přes UI badge v Payload. Začni s emailem, UI badge v E1.

---

## B7. Bind agent identity to OAuth2 consent flow

**Cíl:** Když agent získává customer-scoped access token přes OAuth2, consent screen zobrazí **kdo žádá** (z Agent registry, ne jen client_id).

**Závislosti:** B2.

**Soubory:**

- `src/app/oauth/authorize/page.tsx` (rozšířit — fetch agent metadata)
- `src/lib/oauth/config.ts` (registr klientů → bind na agent ID)
- `src/lib/oauth/codes.ts` (přidat agent_id do auth code metadata)
- `src/lib/oauth/tokens.ts` (přidat agent_id do JWT claims)

**Implementace:**

OAuth2 client_id už existuje. Přidat mapping:

```env
OAUTH_CLIENTS=openai-chatgpt:hash:redirect|...,google-gemini:hash:redirect|...
```

Mapping `oauth_client_id → agent_id`:

```ts
// config.ts
export function getAgentForOauthClient(clientId: string): string | null {
	const mapping = JSON.parse(process.env.OAUTH_CLIENT_AGENT_MAPPING ?? "{}");
	return mapping[clientId] ?? null;
}
```

Consent screen (`/oauth/authorize`):

```tsx
const agent = await getAgentById(getAgentForOauthClient(clientId));
return (
	<ConsentForm>
		<Heading>{agent.display_name} žádá o přístup k vašemu účtu</Heading>
		<PlatformBadge platform={agent.platform} />
		<ScopeList scopes={requestedScopes} />
		<SecurityNote>Tato platforma je registrovaný agent. Verifikováno: ed25519 podpisem.</SecurityNote>
	</ConsentForm>
);
```

Token JWT po consent obsahuje `agent_id` claim.

**Acceptance:**

- [ ] Consent screen ukazuje agent display_name a platform badge (ne jen client_id).
- [ ] JWT access token má `agent_id` claim.
- [ ] Resource server (UCP/ACP/MCP) může extrahovat agent_id z tokenu.
- [ ] Neznámý OAuth client → consent screen ukáže "Neregistrovaný agent" warning (nebo odmítne).

---

## B8. `accepted_platforms` registry v `/.well-known/ucp`

**Cíl:** Profil veřejně publikuje, jaké agent platformy jsou důvěryhodné, s jejich public keys. Agent může toto použít pro discovery.

**Závislosti:** B2.

**Soubory:**

- `src/lib/protocols/ucp/profile-builder.ts`
- `src/lib/protocols/ucp/types.ts`

**Implementace:**

```ts
type UcpProfile = {
	ucp: {
		/* ... */
	};
	signing_keys: UcpSigningKey[];
	accepted_platforms?: AcceptedPlatform[];
};

type AcceptedPlatform = {
	platform: "openai" | "google" | "anthropic" | "microsoft";
	display_name: string;
	trust_level: "verified" | "experimental";
	public_keys: string[]; // base64 ed25519
	contact_url?: string;
};
```

Loader: `listActiveAgents()` z B2 → group by `platform` → output.

**Acceptance:**

- [ ] `GET /.well-known/ucp` obsahuje `accepted_platforms[]` s neprázdným seznamem.
- [ ] Per-tenant volba: `Tenant.accepted_platforms_override` (Payload field) může restriktovat seznam.

---

## B9. Migration `AGENT_API_KEYS` → Agent registry

**Cíl:** Bezpečně přejít z legacy bearer tokenů na registry. Žádný klient nesmí být shozen.

**Závislosti:** B2, B3.

**Soubory:**

- `src/lib/protocols/shared/auth.ts`
- `.env.example` (deprecation note)
- `MIGRATION.md` (nový)

**Implementace:**

Dual-mode auth:

```ts
async function verifyAgentRequest(req: Request) {
	// 1. Try signed request (B3)
	if (req.headers.has("UCP-Signature")) return verifySigned(req);

	// 2. Fallback: legacy bearer
	const auth = req.headers.get("Authorization");
	if (auth?.startsWith("Bearer ")) {
		const token = auth.slice(7);
		if (process.env.AGENT_API_KEYS?.split(",").includes(token)) {
			console.warn("[DEPRECATED] AGENT_API_KEYS bearer auth used. Migrate to signed requests.");
			return { agent: SYNTHETIC_LEGACY_AGENT, bodyText: await req.text() };
		}
	}

	return { error: "No valid auth", status: 401 };
}
```

`SYNTHETIC_LEGACY_AGENT`:

```ts
const SYNTHETIC_LEGACY_AGENT: AgentIdentity = {
	id: "legacy-bearer",
	display_name: "Legacy bearer auth",
	platform: "custom",
	status: "active",
	public_key: "",
	scope: ["catalog.read", "cart.create", "cart.update", "checkout.create", "checkout.complete"],
	spending_limit: { per_session_cents: 100_000_00, per_day_cents: null, per_month_cents: null },
	rate_limit: { requests_per_minute: 30, sessions_per_day: 1000 },
	created_at: new Date().toISOString(),
	updated_at: new Date().toISOString(),
};
```

Migration timeline:

- Day 0: dual-mode released.
- Day 30: emails klientům s instrukcemi pro migraci.
- Day 90: `console.warn` → `console.error` v dev modu.
- Day 180: legacy bearer **odstraněn**, env var `AGENT_API_KEYS` ignorován.

`MIGRATION.md` s krokama pro klienty (Algaweb klient, který používá tuto šablonu pro svůj e-shop).

**Acceptance:**

- [ ] Legacy bearer auth stále funguje, ale loguje deprecation warning.
- [ ] Signed request preferred (zkoušen první).
- [ ] `MIGRATION.md` obsahuje 5-step migrace pro klienta.

---

## B10. Abuse signals: rate anomalies, duplicate sessions, address heuristics

**Cíl:** Detekovat podezřelé patterns: prudký nárůst requestů od jednoho agenta, duplicate cart/checkout sessions s různými adresami, atd. Suspendovat při překročení threshold.

**Závislosti:** B4 (activity log), B2 (registry pro `status: suspended`).

**Soubory:**

- `src/lib/protocols/shared/abuse-detection.ts` (nový)
- Background job (cron nebo scheduled function): `src/app/api/cron/abuse-scan/route.ts` (nový)

**Implementace:**

Heuristics (každá s konfigurovatelným threshold):

1. **Rate spike**: `requests_per_minute > 5 × baseline` → flag.
2. **Duplicate sessions**: stejný `session_id` použitý ve > 3 různých `agent_id` v hodině → flag agentů.
3. **Address shotgunning**: > 10 různých shipping addresses pro 1 agent_id v 24h → flag.
4. **Cart abandonment ratio**: agent vytvoří 100 cartů, dokončí 0 → low signal, pokud trvá týden → flag.
5. **Failed checkout attempts**: > 50% complete attempts fail (payment declined, validation error) → flag.

Akce při flag:

- 1× flag: log warning, notify klient (email).
- 3× flag v týdnu: auto-`status: suspended`. Klient musí ručně reaktivovat v Payload.

Cron schedule: každou hodinu (Vercel Cron nebo Cloudflare Cron Trigger).

**Acceptance:**

- [ ] Test: simulace 50 requestů/minutu od jednoho agenta → flag in `AgentActivity` se `status: anomaly_detected`.
- [ ] Auto-suspension funguje + email notification.
- [ ] Klient v Payload může ručně reactivate.

**Notes:**

- **Toto NEZASTUPUJE Stripe Radar.** Doplňuje na úrovni UCP/ACP. Stripe Radar řeší fraud na úrovni payment, my řešíme abuse na úrovni agent commerce.

---

# Fáze C — Post-order & multi-payment handlers

**Cíl:** Refaktorovat payment handlers na multi-handler architekturu, přidat post-order capabilities (returns, refunds), eligibility a disclosure contracts. Připravit terén pro Czech-specific handlery (Phase D).

**Trvání:** ~2 týdny.

**Výstup fáze:** Profil deklaruje `dev.ucp.shopping.returns` a `dev.ucp.shopping.loyalty`. Payment handlers jsou registrovatelné — Stripe SPT, Link wallet, stablecoin, MPP. Eligibility framework připravený pro IČO/DIČ (Phase D).

---

## C1. Implement `dev.ucp.shopping.returns` capability + REST endpoint

**Cíl:** Agent může iniciovat reklamaci/vrácení (refund) z customer-scoped scope.

**Závislosti:** A2, B7 (OAuth s agent ID).

**Soubory:**

- `src/lib/protocols/ucp/profile-builder.ts`
- `src/lib/protocols/ucp/capabilities.ts`
- `src/app/api/ucp/rest/orders/[id]/return/route.ts` (nový)
- `src/lib/protocols/shared/return-mapper.ts` (nový)

**Implementace:**

```
POST /api/ucp/rest/orders/:id/return
Body: {
  reason: "defective" | "not_as_described" | "changed_mind" | "wrong_item",
  note?: string,
  lines?: { line_id: string, quantity: number }[],   // partial return; empty = full
  refund_method: "original_payment" | "store_credit"
}
Response: {
  return_id: string,
  status: "pending" | "approved" | "rejected",
  estimated_refund_cents: number,
  expected_refund_at?: string,
}
```

Saleor mapping: `OrderRefund` mutation pro plný refund, `FulfillmentReturnProducts` pro partial.

**Acceptance:**

- [ ] `POST /api/ucp/rest/orders/:id/return` s OAuth user-scoped tokenem vrátí 200 s `return_id`.
- [ ] Bez OAuth tokenu (jen agent token) → 403.
- [ ] Saleor order má `Refund` event po úspěšném return.
- [ ] Nelze vrátit order, který už má `status: returned` nebo > 30 dní starý (per-tenant config).

---

## C2. Map returns to Saleor mutations + status updates

**Cíl:** Skutečné napojení na Saleor refund/return flow + status zpětně přes webhook do agenta.

**Závislosti:** C1.

**Soubory:**

- `src/lib/protocols/shared/return-queries.ts` (nový — Saleor mutations)
- `src/app/api/webhooks/saleor/route.ts` (rozšířit o `ORDER_REFUNDED`, `ORDER_RETURN_REQUESTED`)

**Implementace:**

Saleor events to listen:

- `ORDER_REFUNDED` → update return record, notify agent.
- `FULFILLMENT_RETURNED` → analogicky.

Webhook → agent notification:

- Pokud agent při create return uvedl `webhook_url` v request → POST to that URL.
- Jinak: agent musí poll `GET /api/ucp/rest/orders/:id/return/:return_id`.

**Acceptance:**

- [ ] Po Saleor `ORDER_REFUNDED` webhook se status return změní na `approved`.
- [ ] Agent webhook (pokud poskytnut) je voláno s exponential backoff retry.
- [ ] Polling endpoint vrátí konzistentní status.

---

## C3. Returns webhook handling pro agent notifications

**Cíl:** Doplnění C2 — robustní webhook delivery k agentovi (retry, signature, audit).

**Závislosti:** C2, A1 (signing).

**Soubory:**

- `src/lib/protocols/shared/agent-webhooks.ts` (nový)

**Implementace:**

```ts
export async function notifyAgent(
	agent: AgentIdentity,
	webhook_url: string,
	event: AgentEvent,
): Promise<{ delivered: boolean; attempts: number }> {
	const signature = await signPayload(JSON.stringify(event));
	for (let attempt = 1; attempt <= 5; attempt++) {
		const res = await fetch(webhook_url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"UCP-Signature": signature,
				"UCP-Event-Type": event.type,
			},
			body: JSON.stringify(event),
		});
		if (res.ok) return { delivered: true, attempts: attempt };
		await sleep(Math.pow(2, attempt) * 1000); // 2s, 4s, 8s, 16s, 32s
	}
	return { delivered: false, attempts: 5 };
}
```

Persisted retry queue (volitelně, pro robustnost): Payload `WebhookDeliveries` collection.

**Acceptance:**

- [ ] Retry s exponential backoff (max 5 attempts).
- [ ] Signed payload (UCP-Signature header).
- [ ] Failed deliveries logged v `AgentActivity`.

---

## C4. Eligibility claims framework

**Cíl:** UCP 2026-04-08 přidává eligibility contracts. Implementovat framework, do kterého půjdou plug-in claims (B2B v D5, věk v C5, region, atd.).

**Závislosti:** A2.

**Soubory:**

- `src/lib/protocols/shared/eligibility.ts` (nový)
- `src/lib/protocols/ucp/types.ts` (`UcpEligibilityClaim`)
- Integrace v `cart` a `checkout-session` mapperech.

**Implementace:**

```ts
type EligibilityClaim = {
	type: "b2b" | "age" | "region" | "license" | string;
	status: "verified" | "claimed" | "denied" | "required";
	evidence?: Record<string, unknown>; // např. { vat_id: "CZ12345678", verified_at: "..." }
	message?: string; // human-readable explanation
};

type EligibilityRequirement = {
	type: string;
	applies_to: "cart" | "line" | "shipping_method";
	applies_to_id?: string;
	required: boolean;
	message: string;
};

export function checkEligibility(
	cart: UcpCart,
	claims: EligibilityClaim[],
): { allowed: boolean; missing_requirements: EligibilityRequirement[] };
```

Plug-in registry:

```ts
type EligibilityChecker = (cart: UcpCart, line?: UcpCartLine) => EligibilityRequirement[];
const checkers: EligibilityChecker[] = [];
export function registerEligibilityChecker(c: EligibilityChecker) {
	checkers.push(c);
}
```

V D5 se zaregistruje B2B checker, v C5 age/disclosure checker.

**Acceptance:**

- [ ] Framework + typy + register API existují.
- [ ] Cart/checkout response obsahuje `eligibility_requirements[]` pole pokud jsou nesplněné.
- [ ] Empty registry → žádné requirements.

---

## C5. Disclosure contracts implementation

**Cíl:** Některé produkty vyžadují disclosure: alkohol (věk), doplňky stravy ("není léčivo"), elektronika (recyklační poplatek). UCP 2026-04-08 to standardizuje jako warning/disclosure contracts.

**Závislosti:** C4.

**Soubory:**

- `src/lib/protocols/shared/disclosures.ts` (nový)
- Saleor: doporučená nová product attribute `disclosure_type` (slug list).

**Implementace:**

Saleor product má attribute `disclosure_type` (multi-select): `alcohol`, `dietary_supplement`, `medical_device_class_i`, atd.

Mapper:

```ts
function buildDisclosures(product: SaleorProduct): UcpWarning[] {
	const types =
		product.attributes.find((a) => a.attribute.slug === "disclosure_type")?.values.map((v) => v.slug) ?? [];

	return types.map((t) => DISCLOSURES[t]).filter(Boolean);
}

const DISCLOSURES: Record<string, UcpWarning> = {
	alcohol: {
		type: "age_restriction",
		severity: "high",
		message: "Tento produkt obsahuje alkohol. Prodej osobám mladším 18 let je zakázán.",
		requires_eligibility: ["age:18+"],
	},
	dietary_supplement: {
		type: "regulatory_disclosure",
		severity: "low",
		message: "Doplněk stravy. Nenahrazuje pestrou stravu.",
	},
	// ...
};
```

V cart/order response: `warnings[]` field.

**Acceptance:**

- [ ] Cart obsahující produkt s `disclosure_type: alcohol` má `warnings[]` se `age_restriction`.
- [ ] Eligibility requirement `age:18+` se objeví v `eligibility_requirements`.
- [ ] Klient může editovat texty disclosures per-tenant (Payload field).

---

## C6. Multi-handler payment registry refactor

**Cíl:** Z monolitického `payment_handlers: { stripe_spt: [...] }` v profile-builderu udělat **registry**, kde se handlers registrují/načítají z konfigu nebo plug-inů.

**Závislosti:** A2, A6.

**Soubory:**

- `src/lib/protocols/shared/payment-handlers.ts` (nový — registry)
- `src/lib/protocols/ucp/profile-builder.ts` (použít registry)
- `src/lib/protocols/handlers/stripe-spt.ts` (extrakt z profile-builderu)

**Implementace:**

```ts
type PaymentHandlerDefinition = {
	id: string; // např. "com.stripe.shared_payment_token"
	build: () => UcpPaymentHandlerEntry[] | null; // null = handler not configured
};

const handlers: PaymentHandlerDefinition[] = [];
export function registerPaymentHandler(h: PaymentHandlerDefinition) {
	handlers.push(h);
}

export function buildPaymentHandlersForProfile(): Record<string, UcpPaymentHandlerEntry[]> {
	const result: Record<string, UcpPaymentHandlerEntry[]> = {};
	for (const h of handlers) {
		const entries = h.build();
		if (entries && entries.length > 0) result[h.id] = entries;
	}
	return result;
}
```

Handler skeleton (`stripe-spt.ts`):

```ts
import { registerPaymentHandler } from "../payment-handlers";

registerPaymentHandler({
	id: "com.stripe.shared_payment_token",
	build: () => {
		const key = process.env.STRIPE_PUBLISHABLE_KEY;
		if (!key) return null;
		return [
			{
				id: "stripe_spt",
				version: process.env.UCP_VERSION,
				config: {
					publishable_key: key,
					available_payment_instruments: parseInstruments(process.env.STRIPE_AVAILABLE_INSTRUMENTS),
				},
			},
		];
	},
});
```

`profile-builder.ts` — jen volá `buildPaymentHandlersForProfile()`.

**Acceptance:**

- [ ] Handler registration funguje.
- [ ] Stripe SPT handler je extracted, behaviorálně 1:1 se starým kódem.
- [ ] Profil bez `STRIPE_PUBLISHABLE_KEY` má `payment_handlers: {}` (žádný entry).
- [ ] Žádný breaking change pro existující klienty.

---

## C7. `com.stripe.link_agent_wallet` handler

**Cíl:** Agent přináší vlastní Link wallet credential (Stripe Sessions 2026 announcement). Deklarovat handler v profilu.

**Závislosti:** C6.

**Soubory:**

- `src/lib/protocols/handlers/stripe-link-wallet.ts` (nový)
- `src/lib/protocols/shared/payment.ts` (rozšíření — handle Link wallet token v checkout complete)

**Implementace:**

```ts
registerPaymentHandler({
	id: "com.stripe.link_agent_wallet",
	build: () => {
		if (!process.env.STRIPE_LINK_WALLET_ENABLED) return null;
		return [
			{
				id: "stripe_link",
				version: process.env.UCP_VERSION,
				config: {
					publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
					wallet_provider: "stripe.link",
					available_payment_instruments: ["wallet.link"],
				},
			},
		];
	},
});
```

Checkout complete handling: agent v `complete` request pošle `payment.method: "stripe.link"` + `payment.token: "<link_wallet_token>"`. Server pošle Stripe `paymentIntent.confirm` s tímto tokenem.

**Acceptance:**

- [ ] Profil deklaruje `com.stripe.link_agent_wallet` pokud env var nastaveno.
- [ ] Checkout complete s Link wallet tokenem → Stripe payment intent confirm.
- [ ] Order completes successfully end-to-end (sandbox).

**Notes:**

- Stripe Link wallet token specifika viz Stripe API docs (2026 verze). Pokud spec ještě není zveřejněna, implementuj skeleton handler + integration se Stripe to be confirmed.

---

## C8. `com.stripe.stablecoin` handler (declarative)

**Cíl:** Deklarovat stablecoin acceptance v profilu. Skutečné processing dělá Stripe.

**Závislosti:** C6.

**Soubory:**

- `src/lib/protocols/handlers/stripe-stablecoin.ts` (nový)

**Implementace:**

```ts
registerPaymentHandler({
	id: "com.stripe.stablecoin",
	build: () => {
		const stablecoins = parseStablecoins(process.env.STRIPE_ACCEPTED_STABLECOINS);
		if (!stablecoins.length) return null;
		return [
			{
				id: "stripe_stablecoin",
				version: process.env.UCP_VERSION,
				config: {
					publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
					available_payment_instruments: stablecoins.map((s) => `stablecoin.${s}`),
					supported_chains: parseChains(process.env.STRIPE_STABLECOIN_CHAINS),
				},
			},
		];
	},
});
```

Env:

```
STRIPE_ACCEPTED_STABLECOINS=usdc,usdg
STRIPE_STABLECOIN_CHAINS=ethereum,solana,base
```

Checkout complete: Stripe SPT API přijímá `payment_method: stablecoin` per Stripe 2026 docs.

**Acceptance:**

- [ ] Profil deklaruje stablecoin handler s `available_payment_instruments: ["stablecoin.usdc", ...]`.
- [ ] Test komplet checkout flow s `payment.method: "stablecoin.usdc"` (Stripe sandbox).

**Notes:**

- **Pro CZ klienty NEDOPORUČOVAT defaultně.** Diferenciační feature, ale pro 99 % CZ e-shopů zbytečnost. Default `STRIPE_ACCEPTED_STABLECOINS=` (empty) → handler neaktivní.

---

## C9. `com.stripe.machine_payments` (MPP) handler skeleton

**Cíl:** Připravit handler pro Machine Payments Protocol — recurring/streaming/micro. Pro digital/SaaS klienty.

**Závislosti:** C6.

**Soubory:**

- `src/lib/protocols/handlers/stripe-mpp.ts` (nový — skeleton)
- `src/app/api/ucp/rest/payment-mandates/route.ts` (nový — recurring payment authorization)

**Implementace:**

Skeleton, plný pilot v E7. Deklarovat v profilu, ale checkout flow přes MPP je out-of-scope běžného shoppingu — patří k usage-based billing.

```ts
registerPaymentHandler({
	id: "com.stripe.machine_payments",
	build: () => {
		if (!process.env.MPP_ENABLED) return null;
		return [
			{
				id: "stripe_mpp",
				version: process.env.UCP_VERSION,
				config: {
					publishable_key: process.env.STRIPE_PUBLISHABLE_KEY,
					protocols: ["mpp.v1"],
					supports_streaming: true,
					supports_recurring: true,
					supports_micropayments: true,
				},
			},
		];
	},
});
```

Mandate endpoint (skeleton):

```
POST /api/ucp/rest/payment-mandates
Body: { agent_id, max_per_period_cents, period: "day"|"month", expires_at }
Response: { mandate_id, status: "active" }
```

**Acceptance:**

- [ ] Profil deklaruje MPP handler pokud `MPP_ENABLED=true`.
- [ ] `POST /api/ucp/rest/payment-mandates` vrátí mandate ID (skeleton, ne plný flow).
- [ ] Skeleton je dokumentovaný jako preview, ne production.

---

## C10. `dev.ucp.shopping.loyalty` capability + giftCard/voucher binding

**Cíl:** Loyalty capability — agent může aplikovat věrnostní body, gift card, voucher. Mapuje na Saleor `GiftCard` a `Voucher`.

**Závislosti:** A4 (cart), C4 (eligibility, pro membership-tier vouchery).

**Soubory:**

- `src/lib/protocols/ucp/capabilities.ts` (přidat `LOYALTY`)
- `src/app/api/ucp/rest/carts/[id]/loyalty/route.ts` (nový — apply/remove)
- `src/lib/protocols/shared/loyalty-mapper.ts` (nový)

**Implementace:**

```
POST   /api/ucp/rest/carts/:id/loyalty           → apply { code: "GIFT123" } nebo { customer_points: 500 }
DELETE /api/ucp/rest/carts/:id/loyalty/:appliedId → remove
```

Saleor: `checkoutAddPromoCode` mutation (gift card i voucher přes stejný endpoint, Saleor distinguishuje).

Loyalty points: pokud Saleor nemá native loyalty, redukuj přes voucher s computed value (custom logic v Saleor metadata).

**Acceptance:**

- [ ] Apply gift card → cart `applied_discounts[]` obsahuje entry, totals snížené.
- [ ] Remove → totals reset.
- [ ] Invalid code → 400 s message.
- [ ] Profil deklaruje loyalty capability.

---

# Fáze D — Czech moat

**Cíl:** Algaweb-specific competitive features pro CZ trh. **Tady se buduje moat** — žádný český storefront tohle dnes nemá.

**Trvání:** ~3 týdny.

**Výstup fáze:** Comgate/GoPay agent payment handlers, Zásilkovna jako UCP fulfillment, IČO/DIČ ARES verification, DPH handling, lokalizované messaging, Heureka/Zboží feed v UCP catalog formátu, právní disclosures.

---

## D1. `cz.comgate.shared_payment_token` UCP payment handler

**Cíl:** Comgate jako UCP-spec payment handler. Žádný CZ storefront nemá agent-friendly Comgate.

**Závislosti:** C6.

**Soubory:**

- `src/lib/protocols/handlers/comgate.ts` (nový)
- `src/app/api/ucp/payment/comgate/callback/route.ts` (nový — webhook)
- `src/lib/protocols/shared/payment.ts` (rozšířit `processPayment` o Comgate)

**Implementace:**

```ts
registerPaymentHandler({
	id: "cz.comgate.shared_payment_token",
	build: () => {
		if (!process.env.COMGATE_MERCHANT_ID) return null;
		return [
			{
				id: "comgate_spt",
				version: process.env.UCP_VERSION,
				config: {
					merchant_id: process.env.COMGATE_MERCHANT_ID,
					environment: process.env.COMGATE_TEST === "true" ? "sandbox" : "production",
					available_payment_instruments: ["card", "bank_transfer.cz", "google_pay", "apple_pay"],
				},
			},
		];
	},
});
```

Flow:

1. Agent posílá checkout complete s `payment.handler: "comgate_spt"`.
2. Server vytvoří Comgate payment session (Comgate API `create` endpoint).
3. Vrátí agentovi `redirect_url` (pokud nutný redirect) **nebo** completed status pro tokenized flow.
4. Comgate webhook callback → server marks order paid + Saleor `orderMarkAsPaid`.

Comgate API docs: https://help.comgate.cz/v2/docs/protokol-api (zarezervovat čas — API je stabilní, dobře dokumentované).

**Acceptance:**

- [ ] Sandbox checkout flow funguje end-to-end (test card payment).
- [ ] Webhook signature verifikovaný (Comgate používá HMAC).
- [ ] Order v Saleoru je marked paid.
- [ ] Profil deklaruje handler.

**Notes:**

- **API integrace, ne agent-only.** Stejný handler funguje i pro browser checkout — sjednotit s existujícím Saleor Comgate App pokud existuje.

---

## D2. `cz.gopay.shared_payment_token` UCP payment handler

**Cíl:** Identicky jako D1, ale pro GoPay.

**Závislosti:** C6.

**Soubory:**

- `src/lib/protocols/handlers/gopay.ts` (nový)
- `src/app/api/ucp/payment/gopay/callback/route.ts` (nový)

**Implementace:** Analogicky D1. GoPay docs: https://help.gopay.com/cs/

**Acceptance:** Analogicky D1.

---

## D3. Zásilkovna jako UCP fulfillment capability

**Cíl:** Agent v UCP cart vybere pickup point bez nutnosti widget v UI. Capability `dev.ucp.shopping.fulfillment` rozšířena o Zásilkovna pickup-point flow.

**Závislosti:** A4 (cart).

**Soubory:**

- `src/lib/protocols/ucp/capabilities.ts`
- `src/app/api/ucp/rest/fulfillment/zasilkovna/points/route.ts` (nový — list pickup points)
- `src/app/api/ucp/rest/carts/[id]/shipping/route.ts` (nový — set shipping method + pickup point)

**Implementace:**

```
GET /api/ucp/rest/fulfillment/zasilkovna/points?lat=50.08&lng=14.43&country=CZ
→ [{ id: "1234", name: "Praha 1 - Václavské náměstí", address: "...", coords, opening_hours }]

POST /api/ucp/rest/carts/:id/shipping
Body: { method: "zasilkovna", point_id: "1234" }
```

Saleor mapping: ulož pickup point ID/name/address do checkout metadata (`zasilkovna_point_id`, atd. — již existuje pro browser flow, sdílet stejné klíče).

Zásilkovna API: https://www.zasilkovna.cz/api → API klíč v `ZASILKOVNA_API_KEY`.

**Acceptance:**

- [ ] Agent může listovat pickup points blízko adresy.
- [ ] Agent může setovat shipping method na cart.
- [ ] Čekoutní flow zachová pickup point až do order.

---

## D4. PPL / Česká pošta / Balíkovna fulfillment

**Cíl:** Multi-carrier support v UCP fulfillment. Stejný pattern jako D3.

**Závislosti:** D3.

**Soubory:**

- `src/lib/protocols/handlers/shipping-ppl.ts` (nový)
- `src/lib/protocols/handlers/shipping-cp.ts` (nový — Česká pošta)
- `src/lib/protocols/handlers/shipping-balikovna.ts` (nový)

**Implementace:**

Per-carrier registry (analogie payment handlers):

```ts
type ShippingHandler = {
	id: string;
	build: () => UcpShippingMethod | null;
	listPickupPoints?: (location: LatLng) => Promise<PickupPoint[]>;
};
```

PPL pickup points: PPL API. Česká pošta: Balíkovna API (pošta používá Balíkovnu jako pickup point system).

**Acceptance:**

- [ ] 3 carriers v profilu pokud env nastaveno.
- [ ] Pickup point lookup funguje pro každý carrier (pokud existuje).

**Notes:**

- **Šetři čas:** Pokud klient nepoužívá PPL, env var prázdný → carrier se nedeklaruje. Žádné carrier není "must have".

---

## D5. IČO/DIČ jako UCP eligibility claim s ARES verifikací

**Cíl:** B2B nákup s ověřeným IČO/DIČ → eligibility verified. Reverse charge DPH automaticky.

**Závislosti:** C4 (eligibility framework).

**Soubory:**

- `src/lib/protocols/checkers/b2b-cz.ts` (nový — eligibility checker)
- `src/lib/cz/ares.ts` (nový — ARES API client)

**Implementace:**

ARES (Administrativní registr ekonomických subjektů) API: https://ares.gov.cz/swagger-ui/

```ts
export async function verifyIcoDic(
	ico: string,
	dic: string,
): Promise<{
	verified: boolean;
	company_name?: string;
	vat_status?: "registered" | "not_registered";
	evidence: { ares_response: any };
}> {
	const ares = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${ico}`);
	// ...
}

registerEligibilityChecker((cart, line) => {
	if (!cart.context?.b2b_purchase) return [];
	if (cart.context.b2b_verified) return [];
	return [{ type: "b2b", applies_to: "cart", required: true, message: "B2B nákup vyžaduje ověřené IČO" }];
});
```

V cart create/update accept `context.ico` + `context.dic`, async-verify v ARES, set `context.b2b_verified: true`, store evidence v metadata.

**Acceptance:**

- [ ] Cart s `context.ico: "12345678"` (valid CZ IČO) → b2b_verified po async ARES call.
- [ ] Invalid IČO → eligibility requirement remains.
- [ ] DPH na cart total reflects reverse charge (viz D6).

**Notes:**

- ARES API rate limit: cca 100 req/s, bez auth. Cache výsledky 24h per IČO.

---

## D6. Czech VAT (DPH) handling v UCP totals

**Cíl:** Totals respektují české DPH sazby (21 %, 12 %, 0 %), reverse charge pro B2B EU, intra-EU specifika.

**Závislosti:** D5.

**Soubory:**

- `src/lib/protocols/shared/tax-cz.ts` (nový)
- `src/lib/protocols/shared/checkout-mapper.ts` (rozšíření)

**Implementace:**

Saleor má vlastní tax engine (configurable per-channel). Pro CZ:

- Saleor tax classes: "základní 21 %", "snížená 12 %", "nulová 0 %".
- Per-product tax class.
- Per-zone tax (CZ vs EU vs ROW).

UCP totals z Saleor by měly **respektovat tax engine**, nedělat custom logiku v storefront. Jen mapper.

Reverse charge: Pokud `b2b_verified: true` AND VAT registered v jiném EU státě → tax 0 %, line `tax_treatment: "reverse_charge"`.

```ts
type UcpTotalsBreakdown = {
	type: "tax" | "discount" | "shipping";
	rate: number; // např. 0.21 pro 21 %
	amount_cents: number;
	treatment?: "standard" | "reverse_charge" | "exempt";
};
```

**Acceptance:**

- [ ] Cart s CZ produkty + CZ shipping → standard 21 % (nebo per-product rate).
- [ ] Cart s b2b_verified + EU shipping → reverse charge (0 % v totals, treatment marker).
- [ ] Saleor tax engine je single source of truth.

---

## D7. Czech localization of agent messages

**Cíl:** UCP error messages, disclosures, eligibility messages — česky pro CZ klienty.

**Závislosti:** A2, C5.

**Soubory:**

- `src/messages/cs.json` (rozšíření o `protocols.*` namespace)
- `src/messages/en.json`
- `src/lib/protocols/shared/messages.ts` (nový — i18n loader pro protocols)

**Implementace:**

UCP/ACP responses obsahují `messages[]` s human-readable texty. Tenant volí jazyk přes `Accept-Language` header nebo per-tenant config.

```ts
export function getProtocolMessage(key: string, locale: string): string {
	const messages = locale === "cs" ? csProtocols : enProtocols;
	return messages[key] ?? key;
}
```

Příklady (cs.json):

```json
{
	"protocols.disclosure.alcohol": "Tento produkt obsahuje alkohol. Prodej osobám mladším 18 let je zakázán.",
	"protocols.eligibility.b2b_required": "Tento produkt je dostupný pouze pro B2B zákazníky s ověřeným IČO.",
	"protocols.error.cart_expired": "Košík vypršel. Vytvořte nový.",
	"protocols.error.invalid_ico": "IČO není ve správném formátu (8 číslic)."
}
```

**Acceptance:**

- [ ] Response s `Accept-Language: cs` má české texty.
- [ ] Default locale (en) zachován.
- [ ] Cca 30+ protocol messages přeložených.

---

## D8. Heureka.cz / Zboží.cz feed v UCP catalog formátu

**Cíl:** Heureka/Zboží feedy generované ze stejné catalog datové vrstvy jako UCP catalog. Žádné dvojí udržování.

**Závislosti:** A5 (UCP catalog).

**Soubory:**

- `src/app/api/feeds/heureka/route.ts` (nový — XML feed)
- `src/app/api/feeds/zbozi/route.ts` (nový — XML feed)
- `src/lib/feeds/heureka-xml-builder.ts` (nový)
- `src/lib/feeds/zbozi-xml-builder.ts` (nový)

**Implementace:**

```ts
// Sdílený data getter
async function getCatalogForFeed(): Promise<UcpCatalogItem[]> {
	return (await fetchAllProductsForCatalog()).map(saleorToUcpCatalog);
}

// Heureka format
function buildHeurekaXml(items: UcpCatalogItem[]): string {
	/* SHOP_ITEM XML format */
}
```

Heureka spec: https://www.heurekashopping.cz/resources/attachments/p/0/0/0/heureka_shop_item.xml.zip

**Acceptance:**

- [ ] `GET /api/feeds/heureka` vrací valid Heureka XML.
- [ ] `GET /api/feeds/zbozi` vrací valid Zboží.cz XML.
- [ ] Cache 1h.
- [ ] Heureka category mapping přes Saleor product attribute `heureka_category`.

---

## D9. Czech consumer law disclosures

**Cíl:** UCP cart/order obsahuje povinné informace per zákon č. 89/2012 (občanský zákoník) — 14-day vrácení, OOS, atd.

**Závislosti:** C5.

**Soubory:**

- `src/lib/protocols/shared/legal-cz.ts` (nový)
- Integrace v cart/order mapper.

**Implementace:**

Auto-injected disclosures per CZ pravidla:

```ts
const CZ_DISCLOSURES = [
	{
		type: "right_to_withdraw",
		severity: "info",
		message: "Spotřebitel má právo odstoupit od smlouvy do 14 dnů od převzetí zboží bez udání důvodu.",
		applies_to: "consumer_purchase", // skip if b2b_verified
	},
	{
		type: "complaint_handling",
		severity: "info",
		message: "Reklamace se vyřizují podle zákona č. 89/2012 Sb., občanský zákoník.",
	},
];
```

V order response: `legal_notices[]` field.

**Acceptance:**

- [ ] Consumer order obsahuje 14-day notice.
- [ ] B2B order tyto skipuje (B2B nemá 14-day right).
- [ ] Per-tenant override (Payload field) pro custom disclosure texty.

---

## D10. `czech-agent-commerce` skill

**Cíl:** Skill rule pro AI agenty pracující s touto šablonou — kompendium CZ-specific protocol kódu.

**Závislosti:** D1–D9.

**Soubory:**

- `skills/saleor-paper-storefront/rules/czech-agent-commerce.md` (nový)

**Implementace:**

Markdown rule file (per `agentskills.io` spec) shrnující:

- Jak zapnout Comgate/GoPay agent handler.
- Jak konfigurovat Zásilkovna pickup point flow.
- Jak fungovat s ARES verifikací.
- DPH handling v cart/totals.
- Heureka/Zboží feed.
- CZ disclosure auto-injection.
- Localization patterns pro protocols messages.

Připravit pro AI implementační pomoc — když budoucí AI session bude přidávat český e-shop, načte si tento skill.

**Acceptance:**

- [ ] Rule file existuje, ~200–300 řádků.
- [ ] Linkuje příslušné soubory v repu.
- [ ] Aktualizován `skills/saleor-paper-storefront/SKILL.md` index.

---

# Fáze E — Produktizace

**Cíl:** Z technické šablony udělat **produkt**. Klient vidí agent commerce v Payload Admin, dostane onboarding flow, monitoring, sales materiál. Tady se realizuje Algaweb Portal vize specifická pro agent commerce.

**Trvání:** ~4 týdny.

**Výstup fáze:** Klient bez technické asistence: zapne agent commerce, vidí kdo nakupuje, schvaluje, monitoruje. Sales materiál pro Algaweb prodej.

---

## E1. Agent commerce control panel v Payload Admin

**Cíl:** Custom view v Payload, kde tenant admin vidí: aktivní agenti, traffic, schválení, limity, settings.

**Závislosti:** B2 (Agents collection), B4 (activity log), B6 (approvals).

**Soubory:**

- `payload-views/AgentCommerceDashboard.tsx` (Payload custom view)
- `payload-views/AgentDetailView.tsx`

**Implementace:**

Multi-tab view:

1. **Overview** — last 24h traffic graph, top agents, error rate, approval queue size.
2. **Agents** — table z `Agents` collection, filter by platform/status.
3. **Activity** — pageinated log z `AgentActivity`.
4. **Approvals** — pending approvals s approve/reject buttons.
5. **Settings** — per-tenant config: approval thresholds, accepted platforms override, default spending limits.

Payload custom view: `https://payloadcms.com/docs/admin/components`

**Acceptance:**

- [ ] Klient v Payload Admin vidí dashboard.
- [ ] Schválení per-row působí na pending approval (background).
- [ ] Settings mají immediate effect (no rebuild).

---

## E2. Onboarding playbook

**Cíl:** Step-by-step guide pro Algaweb klienta nebo Algaweb teammate, jak zapnout agent commerce.

**Závislosti:** A–D.

**Soubory:**

- `docs/agent-commerce-onboarding.md` (nový)
- `docs/agent-commerce-quickstart-cs.md` (česká verze)

**Implementace:**

Cesta:

1. Generate signing keys (skript z A1).
2. Set env vars.
3. Vytvoř Agent v Payload (nebo env JSON) pro každou platformu (OpenAI, Google, Anthropic).
4. Submit `/.well-known/ucp` URL na agent platformy (per-platform discovery procedure).
5. Test `curl` examples pro každou capability.
6. Verify v dashboard (E1).

**Acceptance:**

- [ ] Onboarding < 30 minut pro non-technical Algaweb teammate.
- [ ] Quickstart obsahuje copy-paste příklady.

---

## E3. Agent traffic monitoring + observability

**Cíl:** Backend infrastruktura pro long-term monitoring. `AgentActivity` retention, archiving, metrics export.

**Závislosti:** B4.

**Soubory:**

- `src/app/api/cron/archive-activity/route.ts` (nový — archive >90d entries)
- `src/lib/observability/agent-metrics.ts` (nový — Prometheus-style /metrics endpoint)

**Implementace:**

- Cron archive: každý den smaž `AgentActivity` entries starší 90 dní (volitelně export do JSON před smazáním).
- `/api/metrics` endpoint (per-tenant scope nebo global): basic Prometheus format with `agent_requests_total`, `agent_request_duration_seconds`, atd.
- Integration s Algaweb Grafana stack.

**Acceptance:**

- [ ] Cron běží automaticky.
- [ ] `/api/metrics` exposes základní metriky.
- [ ] Grafana dashboard template (markdown s screenshoty).

---

## E4. Migration playbook for existing Algaweb clients

**Cíl:** Existující Algaweb klienty (na starší šabloně bez 2026-04-08) migrace na novou verzi.

**Závislosti:** A–D.

**Soubory:**

- `MIGRATION_2026.md` (nový)

**Implementace:**

Step-by-step for client repo:

1. Pull latest `storefront` template changes.
2. Resolve merge conflicts (typically `profile-builder.ts`, `.env.example`).
3. Generate signing keys, update env.
4. Migrate `AGENT_API_KEYS` → Agent registry.
5. Run tests.
6. Deploy.

Per-client checklist + rollback procedure.

**Acceptance:**

- [ ] Migration verified na testovacím Algaweb client repu.
- [ ] Rollback scenario otestovaný.

---

## E5. Travel/services capability slots — plug-in architecture

**Cíl:** Šablona umí načíst custom capability handlers z pluginů. Pro Algaweb klienty mimo e-shop (kavárna, kadeřnictví, ubytování).

**Závislosti:** A–D.

**Soubory:**

- `src/lib/protocols/plugins/` (nová directory)
- `src/lib/protocols/plugins/registry.ts`
- `src/lib/protocols/plugins/example-booking.ts` (nový — reference plugin)

**Implementace:**

Plugin shape:

```ts
type CommercePlugin = {
	id: string; // např. "cz.algaweb.salon-booking"
	capabilities: UcpCapabilityDef[];
	routes?: RouteRegistration[]; // capability routes
	handlers?: PaymentHandlerDefinition[];
	shippingHandlers?: ShippingHandler[];
};

const plugins: CommercePlugin[] = [];
export function registerCommercePlugin(p: CommercePlugin) {
	plugins.push(p);
}
```

Při bootu načti `process.env.ENABLED_PLUGINS=cz.algaweb.salon-booking,...` a registruj.

Reference plugin (`example-booking.ts`):

- Capability `dev.ucp.services.booking` (custom namespace, ne UCP).
- Routes: `/api/ucp/rest/bookings/*`.
- Vyžaduje vlastní backend (n8n nebo custom service).

**Acceptance:**

- [ ] Šablona bootuje s 0 plug-iny (default).
- [ ] Reference plugin funguje když enabled.
- [ ] Plug-in registr exposuje capabilities v profilu automaticky.

---

## E6. Reputation feedback loop with agent platforms

**Cíl:** Po dokončené order pošli signál zpět agent platformě (OpenAI, Google) — _"completed_successfully"_ nebo _"order_issue"_. Forward-looking — UCP roadmap to směřuje, ale spec není finální.

**Závislosti:** B2, A1.

**Soubory:**

- `src/lib/protocols/shared/reputation-feedback.ts` (nový)
- Integration s order webhook (C2).

**Implementace:**

Skeleton, parametry per agent platform:

```ts
const FEEDBACK_ENDPOINTS: Record<string, string> = {
	openai: "https://api.openai.com/v1/agent-commerce/feedback", // hypotetické
	google: "https://gemini.googleapis.com/v1/agent-commerce/feedback",
};

export async function sendReputationFeedback(
	agent: AgentIdentity,
	order: UcpOrder,
	signal: "success" | "issue",
): Promise<void> {
	const endpoint = FEEDBACK_ENDPOINTS[agent.platform];
	if (!endpoint) return;
	// POST signed payload
}
```

**Acceptance:**

- [ ] Skeleton existuje, není v prod aktivovaný (env flag `REPUTATION_FEEDBACK_ENABLED`).
- [ ] Hooked na order completed event.

**Notes:**

- **Wait pro UCP/Stripe spec.** Pokud spec není ready k startu E6, postačí skeleton.

---

## E7. MPP streaming/usage payments pilot

**Cíl:** Plný pilot MPP handleru z C9 — pro digital/SaaS klienty Algaweb (pokud takoví jsou).

**Závislosti:** C9.

**Soubory:**

- `src/lib/protocols/handlers/stripe-mpp.ts` (rozšíření na full)
- `src/app/api/ucp/rest/usage-events/route.ts` (nový — meter usage)
- Integration s Stripe Metronome / Tempo.

**Implementace:**

Full Stripe MPP per Stripe API spec 2026. Zatím skeleton — pokud tým nemá konkrétní SaaS klient čekající, posunout o čtvrtletí.

**Acceptance:**

- [ ] Při enable: end-to-end usage-event → Stripe Metronome → invoicing.
- [ ] Test scenario s 1 sandbox klientem.

**Notes:**

- **Optional v této fázi**. Pokud klient čekající není, přeskočit E7 a posunout E8–E10.

---

## E8. Public agent commerce spec doc

**Cíl:** Veřejně dostupný markdown/web dokument (na Algaweb webu nebo separately) popisující, jak agent commerce přes Algaweb funguje. Použitelné jako sales material i jako developer reference.

**Závislosti:** A–D.

**Soubory:**

- `docs/public/algaweb-agent-commerce.md` (nový)
- (Volitelně) deploy na Algaweb web.

**Implementace:**

Sekce:

1. **Co je agent commerce** (Bryceův framing, ale praktický).
2. **Co Algaweb e-shop podporuje** (capabilities tabulka).
3. **Pro merchanty** — jak zapnout, jak monitorovat, jak řešit incidenty.
4. **Pro agent developery** — UCP discovery, signed requests, capabilities reference, examples.
5. **CZ-specific** — Comgate, GoPay, Zásilkovna, ARES, DPH.

**Acceptance:**

- [ ] Dokument je čitelný, < 30 min reading.
- [ ] Existují copy-paste curl příklady pro každou capability.

---

## E9. Sales material / case study

**Cíl:** Slide deck nebo onepager pro Algaweb prodej. Argumentace pro CZ klienta: _"váš e-shop je callable by ChatGPT, Gemini, with verifiable identity, before vaše konkurence"_.

**Závislosti:** E2, E8.

**Soubory:**

- `docs/sales/agent-commerce-pitch.md` (nový)
- `docs/sales/case-study-template.md` (nový)

**Implementace:**

Markdown s outline:

1. Trh: Stripe Sessions 2026 framing — power shifting to buyers.
2. Co konkurence (CZ trh) **nemá**: signed agent identity, multi-platform support, audit, post-order returns přes agenta, ARES-verified B2B agent flow.
3. Co Algaweb klient **dostane**: ...
4. Onboarding timeline.
5. Cena (placeholder).

**Acceptance:**

- [ ] Slide-deck-friendly outline.
- [ ] Konkrétní příklady (Comgate flow demo, ARES verifikace, atd.).

---

## E10. Annual UCP version bump process

**Cíl:** Předpřipravit proces pro UCP 2027-XX upgrade. Definovat, jak udržovat šablonu v synci s evolucí UCP/ACP/MPP.

**Závislosti:** A–D zkušenosti.

**Soubory:**

- `docs/ucp-version-upgrade-playbook.md` (nový)

**Implementace:**

Playbook s kroky:

1. Track UCP releases (RSS / GitHub watch).
2. Read changelog, identify breaking changes.
3. Run regression tests proti new spec.
4. Update `UCP_VERSION` env, profile-builder.
5. Migrate existing clients (analogie E4).
6. Deprecation timeline (např. 6 měsíců dual-mode).

**Acceptance:**

- [ ] Dokument < 5 stránek, actionable.
- [ ] Přidán do Algaweb wiki (Notion).

---

## Cross-cutting

Tyto věci běží **napříč všemi fázemi** a nejsou v jednotlivých krocích.

### Tests

- Před každým mergem: `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm run build`.
- Per-phase test target: ≥ 80 % coverage nových modulů.
- Integration testy přes MCP Inspector + curl proti dev serveru.
- E2E test scenario: ChatGPT-like agent flow (mock signed request → cart create → checkout complete → order). Maintain v `__tests__/e2e/`.

### Documentation

- Po každé fázi: update relevantních skill rules v `skills/saleor-paper-storefront/rules/`.
- `AGENTS.md` musí odkazovat na tento plán.
- `CLAUDE.md` mít 1–2 řádky pointing → nemodifikovat plán, modifikovat plán.

### Migration safety

- **Žádný breaking change pro existující Algaweb klienty bez 6-měsíčního dual-mode období.**
- Každý nový env var má fallback default.
- Každý nový endpoint je opt-in (přes feature flag nebo env).

### Code quality gate

Před každým commitem:

- TypeScript strict (žádné `any`).
- ESLint clean.
- Žádný nový dependency bez zdůvodnění (audit `pnpm-lock.yaml` diff).

---

## Stav implementace

> Po dokončení každého kroku přidej řádek dolů. Format: `[YYYY-MM-DD] StepID — short note (commit hash)`.

```
[2026-05-04] A1 — ed25519 signing keypair generator + Web Crypto loader (signing.ts), .env.example documented, 11 vitest cases pass
[2026-05-04] A2 — UCP_VERSION default 2026-04-08, schema URLs bumped, capability defs enumerated in capabilities.ts (terrain for A4/A5), error_handling type added, 5 profile-builder tests pass (144 total)
[2026-05-04] A3 — signedJsonResponse + signedUnauthorized/signedProtocolDisabled wrappers, profile-builder publishes signing_keys[], all 5 UCP REST routes + ACP checkout signed, 9 response tests pass (153 total)
[2026-05-04] A4 — dev.ucp.shopping.cart capability + 4 REST routes (POST/GET/PATCH/DELETE carts, POST/PATCH/DELETE lines), cart-mapper.ts maps Saleor Checkout → UCP cart shape (sku per line, mandatory top-level currency, status active/cancelled), 8 cart-mapper tests pass (161 total). Note: A1-A3 had to be reapplied first — Nextcloud sync race had silently rolled back the working tree to git HEAD; commit 5831353b protects against recurrence.
[2026-05-07] A5 — dev.ucp.shopping.catalog capability + 3 REST routes (GET search, GET products/[slug], GET categories), catalog-queries.ts + catalog-mapper.ts map Saleor Product/Category → UCP catalog shape with structured attributes (slug→joined value names), availability enum (in_stock/out_of_stock/preorder), and amount_cents pricing. Cursor-based pagination (next_cursor + has_next_page) deviating from plan's `?page=` since Saleor only supports cursor pagination. MCP search_products tool retained side-by-side. 14 catalog-mapper tests pass (175 total). Workspace migrated to ~/code/storefront/ — sync race no longer a risk.
[2026-05-11] A6 — UcpPaymentHandler.config tightened: open-enum UcpPaymentInstrument type + UcpPaymentHandlerConfig with mandatory available_payment_instruments. Stripe handler advertises instruments from STRIPE_AVAILABLE_INSTRUMENTS env (comma-separated, whitespace-trimmed; default ["card"]; falls back to default when only commas/whitespace). `string & {}` open-enum trick keeps IntelliSense for known values while accepting region-specific strings (e.g. cz.comgate). Static config per plan; A.E1 may swap for dynamic Stripe paymentMethods.list. 5 handler tests pass (180 total).
[2026-05-11] A7 — UCP context (intent, buyer_preferences, agent_session_id) end-to-end: types.ts UcpContext type, shared/context-mapper.ts (validate length 500/2000, contextToMetadataInput, extractContextFromMetadata), CHECKOUT_FRAGMENT + SaleorCheckout type now carry metadata field, cart-mapper + checkout-mapper echo context back. POST /carts/:id and POST /checkout-sessions accept context, persist via updateMetadata + re-fetch. PATCH /carts/:id replaces A4's {intent,notes} shape with {context} (key prefix dropped: ucp.intent → intent per plan). Webhook ORDER_CREATED triggers propagateIntentToOrder() best-effort with SALEOR_APP_TOKEN; idempotent skip if order already has context. 23 context-mapper tests (203 total). Removed compatibility symlink ~/Nextcloud/vibecode/storefront — Nextcloud was resolving it and overwriting target files in ~/code/storefront/, causing yet another sync race.
[2026-05-11] A8 — UCP 2026-04-08 totals contract: new UcpTotals type with mandatory ISO 4217 currency + flat *_cents integer fields (subtotal_cents, discount_cents, shipping_cents, tax_cents, total_cents) + optional UcpTotalsBreakdown[]. ProtocolOrder and ProtocolCheckout now carry top-level `currency` per acceptance #1. Legacy ProtocolTotals retained for ACP (different spec). normalizeCurrency() helper in money.ts forces uppercase ISO 4217 even if Saleor returns lowercase. order-mapper aggregates multiple discount entries into discount_cents. 7 order-mapper tests cover roundtrip, JPY zero-decimal, KWD three-decimal, currency normalization, multi-discount aggregation, breakdown omission. 210 total tests pass.
[2026-05-11] A9 — fix MCP transport endpoint mismatch in profile-builder. Profile used to advertise `${baseUrl}/api/ucp/mcp`, but the real route is `${baseUrl}/mcp` (registered at `src/app/mcp/route.ts`); agents got 404 on the URL the profile told them to use. One-line change + profile-builder test extended to assert the endpoint ends with `/mcp` and explicitly rejects the old `/api/ucp/mcp` form. Also fixed an unrelated tsc gap: order-mapper.test.ts fixture lacked the `channel` field on SaleorOrder (added by an earlier query refactor that vitest didn't catch but tsc does).
```

---

## Apendix A: Klíčové reference

- **UCP spec:** https://ucp.dev/2026-04-08/specification/overview
- **UCP releases:** https://github.com/universal-commerce-protocol/ucp/releases
- **Stripe Sessions 2026 announcements:** https://stripe.com/blog/everything-we-announced-at-sessions-2026
- **ACP spec:** OpenAI agentic commerce docs
- **MPP spec:** Stripe + Tempo joint protocol
- **Saleor GraphQL API:** https://docs.saleor.io/api-reference
- **Comgate API:** https://help.comgate.cz/v2/docs/protokol-api
- **GoPay API:** https://help.gopay.com/cs/
- **Zásilkovna API:** https://www.zasilkovna.cz/api
- **ARES API:** https://ares.gov.cz/swagger-ui/

## Apendix B: Slovník

- **UCP** — Universal Commerce Protocol, https://ucp.dev/
- **ACP** — Agentic Commerce Protocol (OpenAI/Stripe)
- **MCP** — Model Context Protocol (Anthropic)
- **MPP** — Machine Payments Protocol (Stripe + Tempo)
- **SPT** — Shared Payment Token (Stripe)
- **Capability** — UCP-deklarovaná schopnost (cart, checkout, fulfillment, ...)
- **Handler** — implementace specifické subkomponenty (payment handler, shipping handler, ...)
- **Tenant** — jeden klient v Payload multi-tenant modelu
- **Channel** — jeden Saleor channel (= jeden klient v Saleor multi-tenancy)
