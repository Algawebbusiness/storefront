# Vizuální nákupy v Claude, Copilotu a Goose — co se mění pro vaše zákazníky

> 1-pager pro Algaweb klienty. Datum: **květen 2026**.
> Změna se týká všech e-shopů, které máme postavené nad touto šablonou
> (saleor-storefront s MCP serverem). Klient nic neimplementuje, ale
> může zákazníkům komunikovat, že to teď umí.

---

## Co se mění

Doteď, když si zákazník povídal s Claude (nebo s libovolným AI agentem
podporujícím **MCP** — Model Context Protocol), a požádal o "najdi mi
kávu Ethiopia", AI vrátil **text se seznamem produktů**. Funkční, ale
nevypadalo to jako e-shop.

Od května 2026 ten samý dotaz v Claude Desktop / VS Code Copilot / Goose
/ Postman / MCPJam **otevře vizuální okno přímo v chatu**:

- Vyhledávání → **karusel produktů** s fotkami, cenou, dostupností.
- Klik na produkt → **detail produktu** se všemi variantami a galerii.
- "Přidej do košíku" → **náhled košíku** s počty a celkem.
- "Pokračovat k objednávce" → **shrnutí objednávky** s adresami a
  výběrem dopravy.
- Po zaplacení → **potvrzení s číslem objednávky**.

Žádná z těch obrazovek není iframe nebo widget vloženy přes JS. Je to
nový standardní mechanismus protokolu MCP — host (Claude Desktop / atd.)
si HTML stáhne přímo z eshopu a renderuje ve svém okně.

---

## Proč to dělat

| Stav před květnem 2026                                                                          | Co umožňuje MCP Apps                                                                                  |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| AI agent vidí jen text. Zákazník musí věřit, že "Kostarika 250g" je správný produkt.            | Zákazník vidí fotku produktu, cenu, dostupnost. Důvěra v rozhodnutí roste.                            |
| Konkurence vám předbíhá v "AI search" benchmarcích, ale váš obchod ve výsledcích nevypadá živý. | Váš obchod má **stejný vizuální kvalitu uvnitř chatu jako na webu**.                                  |
| Mobilní zákazníci v rozjeté AI conversation neradi přepínají do prohlížeče.                     | Celý nákupní funnel — hledání, detail, košík, checkout, potvrzení — se vyřeší **bez opuštění chatu**. |

Provozně to **nemění nic** — Saleor backend, ceny, sklad, fakturace,
zákaznický servis fungují jako dosud. Webové stránky (`www.váš-shop.cz`)
se nemění, návštěvníci je dále vidí. AI Apps surface je čistý
**aditivní kanál**.

---

## Pro koho je to viditelné

Vizuální okna se aktivují v hostech, které podporují MCP Apps spec
(`2026-01-26`). Aktuálně to znamená:

- **Claude Desktop** (Anthropic) — primárně podporovaná cesta.
- **VS Code Copilot** — pro developery, kteří mají MCP rozšíření.
- **Goose** (Block / Square) — agent-první terminál.
- **Postman + MCPJam** — testovací nástroje.

Hosty, které MCP Apps **nepodporují** (starší MCP klienti, plain
JSON-RPC, vlastní integrace) dostanou jako dosud **plnohodnotný textový
JSON response** (žádná regrese). Spec to vyžaduje — máme to ověřené v
testech (`F8`) i v threat modelu.

---

## Bezpečnost zákaznických dat (co se s daty zákazníka děje)

MCP Apps spec rozlišuje mezi tím, co vidí **model** (AI, který přepisuje
text v chatu) a co vidí **iframe** (vykreslené vizuální okno). Vaše
implementace má dva typy nástrojů:

- **Public** (běžné) — produkty, ceny, dostupnost, kategorie, blog. Vidí
  to model i iframe; je to to, co je veřejné na webu. Žádné PII.
- **Paired** (`get_cart` + `get_cart_full`, `get_checkout` +
  `get_checkout_full`, `get_order` + `get_order_full`) — model vidí jen
  ID + totals + boolean flagy ("má email? má adresu?"); iframe doplní
  e-mail + adresu pro vykreslení. **Model nikdy neuvidí adresy ani e-mail
  zákazníka — ty existují pouze v iframe vrstvě, která je sandboxovaná
  hostem.**

Platba: token zůstává **na straně hosta** (Claude Desktop). Iframe ho
nikdy nevidí. Žádné Stripe credentials v MCP traffic. Detailně v
[`docs/mcp-apps-threat-model.md`](../mcp-apps-threat-model.md).

---

## Co s tím udělat marketingově

Tři jednoduché kroky, které doporučujeme klientům:

1. **Doplnit "Shoppable in AI assistants" do faq / footer**. Jeden
   odstavec, jedna ikona Claude / Copilot / Goose. Vyhledávači zatím není
   třeba říkat víc — schema.org tuhle vrstvu neindexuje, ale interní
   linkbuilding bude v 2027 dohánět.
2. **Zmínit v newsletter nebo blogpostu** v termínu, který odpovídá
   skutečnému deploy → ukázat krátkou GIF nahrávku conversation s
   produktem v Claude Desktop.
3. **Zvážit přidání MCP connectoru do helpu zákazníků** — tj. v
   "Customer support → Chat with our AI agent" mít tlačítko, které
   přidá MCP endpoint do Claude Desktop jedním kliknutím.

Cesta od PR k revenue je krátká: zákazník, který právě v Claude něco
nakoupí, je extrémně cenný — má **0 friction** mezi rozhodnutím a
checkout a obvykle utratí víc než průměr.

---

## Co dělat při problémech

- **Funkce se chová podivně v Claude**: feature flag `MCP_APPS_ENABLED=false`
  na serveru ji okamžitě vypne (return na text-only odpovědi). Restart
  procesu, žádný code deploy. Detaily v
  [`docs/mcp-apps-spec-pinning.md`](../mcp-apps-spec-pinning.md) §4.
- **Bug v UI obrazovce**: napište tickte na náš support. Iframe sandbox
  znamená, že chyba neovlivní zbytek chatu — zákazník vidí textovou
  odpověď s informací "Failed to load shopping UI — see chat for raw
  data" a může pokračovat textem.
- **Spec se mění**: viz quarterly review v `docs/mcp-apps-spec-pinning.md` §3.
  Pinned `@modelcontextprotocol/ext-apps@1.7.1`; revize neproběhne bez
  smoke testu proti reálnému Claude.

---

## Otázky?

Tým Algaweb / Jirka — kontakt podle obvyklých kanálů. Doporučená čtení
před schůzkou:

- [`docs/mcp-apps-readme.md`](../mcp-apps-readme.md) — developer guide
- [`docs/mcp-apps-threat-model.md`](../mcp-apps-threat-model.md) — co je PII a co ne
- [`agentic-commerce-2026-plan.md`](../../agentic-commerce-2026-plan.md) — full project plan (F1–F9)
