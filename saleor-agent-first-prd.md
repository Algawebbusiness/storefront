# Agent-First Saleor E-shop Template — PRD & Implementation Manual

> **Účel dokumentu:** Kompletní zadání pro implementaci SEO a agent-first vrstvy nad Saleor e-shop šablonou (Next.js App Router + Tailwind CSS + Saleor GraphQL API). Tento dokument slouží jako kontext pro programujícího agenta (Claude Code nebo jiný).
>
> **Autor:** Algaweb s.r.o. (Jiří), ve spolupráci s Claude (Anthropic)
>
> **Cílový stack:** Next.js 14+ App Router, React, TypeScript, Tailwind CSS, Saleor GraphQL API, Node.js MCP server
>
> **Cíl:** Šablona eshopu, která na 100 % splňuje klasické SEO best practices a zároveň je optimalizovaná jako "agent-first" — tedy ideálně čitelná a použitelná pro AI agenty (Claude, ChatGPT, Gemini, Perplexity a další).

---

## Obsah

1. [Kontext: Jak AI agenti vidí eshop](#1-kontext)
2. [Část A: Klasické SEO — 100% skóre](#2-klasicke-seo)
3. [Část B: Agent-First vrstva — Structured Data](#3-agent-first-structured-data)
4. [Část C: llms.txt a agent manifest](#4-llms-txt)
5. [Část D: MCP Server — Veřejná vrstva (read-only)](#5-mcp-public)
6. [Část E: MCP Server — Uživatelská vrstva (authenticated)](#6-mcp-authenticated)
7. [Část F: Bezpečnost a autorizace](#7-bezpecnost)
8. [Část G: Testování a validace](#8-testovani)
9. [Přílohy: Referenční GraphQL queries](#9-prilohy)

---

## 1. Kontext: Jak AI agenti vidí eshop {#1-kontext}

### 1.1 Jak agent přistupuje k webu

AI agenti (Claude, ChatGPT, Gemini, Perplexity) nemají prohlížeč. Mají dva základní nástroje:

- **web_search(query)** — pošle krátký dotaz (1–6 slov) do vyhledávače (Claude používá Brave Search, ChatGPT používá Bing) a dostane zpět ~10 výsledků (title, snippet, URL).
- **web_fetch(url)** — vezme URL a vrátí textovou extrakci HTML stránky. JavaScript se NESPOUŠTÍ. Agent vidí pouze to, co je v surovém HTML nebo co zvládne extrakční nástroj vytáhnout.

### 1.2 Co agent vidí po fetchnutí stránky

- Textový obsah (nadpisy, odstavce, ceny, popisky) extrahovaný do markdownu
- Sémantické HTML tagy (h1, h2, nav, main, article, section)
- JSON-LD bloky v `<script type="application/ld+json">` — TY JSOU KLÍČOVÉ
- Meta tagy (title, description, Open Graph)
- Odkazy a anchor texty
- Alt texty obrázků
- Tabulky a seznamy

### 1.3 Co agent NEVIDÍ

- Cokoliv renderované JavaScriptem (CSR komponenty, lazy-loaded data)
- Obrázky (pouze alt text)
- Interaktivní UI prvky (dropdown pro výběr velikosti, color picker)
- Obsah za modály, taby, accordiony
- Dynamicky načtené ceny/dostupnost

### 1.4 Důsledky pro implementaci

**KRITICKÉ:** Veškerá produktová data — název, cena, varianty, dostupnost, atributy, recenze — MUSÍ být přítomna v server-side renderovaném HTML a v JSON-LD blocích. Nespoléhat na client-side rendering pro žádná data, která mají být viditelná agentům.

---

## 2. Část A: Klasické SEO — 100% skóre {#2-klasicke-seo}

### 2.1 Technické SEO — povinné prvky

#### 2.1.1 Meta tagy — na KAŽDÉ stránce

```tsx
// app/products/[slug]/page.tsx
export async function generateMetadata({ params }): Promise<Metadata> {
  const product = await getProduct(params.slug);
  return {
    title: `${product.name} | ${product.category.name} | ${STORE_NAME}`,
    description: product.seoDescription || product.description?.substring(0, 155),
    alternates: {
      canonical: `${BASE_URL}/products/${product.slug}`,
      languages: {
        'cs': `${BASE_URL}/cs/products/${product.slug}`,
        'en': `${BASE_URL}/en/products/${product.slug}`,
      }
    },
    openGraph: {
      title: product.name,
      description: product.seoDescription || product.description?.substring(0, 155),
      url: `${BASE_URL}/products/${product.slug}`,
      type: 'website', // Pro produkty se OG type nastaví přes JSON-LD
      images: product.images.map(img => ({
        url: img.url,
        width: 1200,
        height: 630,
        alt: img.alt || product.name,
      })),
      siteName: STORE_NAME,
      locale: 'cs_CZ',
    },
    twitter: {
      card: 'summary_large_image',
      title: product.name,
      description: product.seoDescription || product.description?.substring(0, 155),
    },
    robots: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  };
}
```

#### 2.1.2 Šablona title tagů

| Typ stránky | Formát |
|---|---|
| Hlavní stránka | `{Store Name} — {tagline}` |
| Kategorie | `{Category Name} | {Store Name}` |
| Produkt | `{Product Name} | {Category} | {Store Name}` |
| Kolekce | `{Collection Name} — {Store Name}` |
| Stránka košíku | `Košík | {Store Name}` |
| Kontakt / Info | `{Page Title} | {Store Name}` |

#### 2.1.3 URL struktura — čistá a hierarchická

```
/                           → Hlavní stránka
/products                   → Listing všech produktů
/products/{slug}            → Detail produktu
/categories/{slug}          → Kategorie
/categories/{slug}/{product-slug} → Alternativní: produkt v kontextu kategorie
/collections/{slug}         → Kolekce
/pages/{slug}               → Statické stránky (O nás, Kontakt, Obchodní podmínky)
/search?q={query}           → Výsledky vyhledávání
/cart                       → Košík
/checkout                   → Checkout
/account                    → Uživatelský účet
/account/orders             → Historie objednávek
```

**Pravidla:**
- Slug VŽDY malými písmeny, bez diakritiky, slova oddělená pomlčkou
- Kanonické URL na každé stránce (`<link rel="canonical" href="...">`)
- Trailing slash konzistentně — BEZ trailing slashe (Next.js výchozí)
- Žádné duplicitní URL (redirect www → non-www, http → https)

#### 2.1.4 Heading hierarchie

Každá stránka MUSÍ mít přesně jeden `<h1>`. Hierarchie musí být logická:

**Produktová stránka:**
```
<h1>Název produktu</h1>
  <h2>Popis</h2>
  <h2>Specifikace</h2>
  <h2>Recenze (127)</h2>
    <h3>Jednotlivá recenze</h3>
  <h2>Související produkty</h2>
```

**Kategorie stránka:**
```
<h1>Název kategorie</h1>
  <h2>Popis kategorie</h2> (volitelný, ale doporučený pro SEO)
  <h2>Produkty</h2>
    <h3>Název produktu 1</h3> (v kartě produktu)
    <h3>Název produktu 2</h3>
```

#### 2.1.5 Sitemap.xml

Dynamicky generovaný sitemap. Implementovat v `app/sitemap.ts`:

```tsx
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const products = await getAllProducts();
  const categories = await getAllCategories();
  const collections = await getAllCollections();
  const pages = await getAllPages();

  return [
    { url: BASE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    ...products.map(p => ({
      url: `${BASE_URL}/products/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
    ...categories.map(c => ({
      url: `${BASE_URL}/categories/${c.slug}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    ...collections.map(c => ({
      url: `${BASE_URL}/collections/${c.slug}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
      priority: 0.6,
    })),
    ...pages.map(p => ({
      url: `${BASE_URL}/pages/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.4,
    })),
  ];
}
```

#### 2.1.6 robots.txt

```tsx
// app/robots.ts
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/checkout', '/account', '/cart', '/api/', '/graphql/'],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
```

### 2.2 Obsahové SEO — na produktových stránkách

#### 2.2.1 Povinné elementy na produktové stránce

Každá produktová stránka MUSÍ v SSR HTML obsahovat:

1. **Název produktu** v `<h1>`
2. **Breadcrumb navigaci** — `Home > Kategorie > Podkategorie > Produkt`
3. **Cenu** jako viditelný text (ne pouze v JS stavu)
4. **Dostupnost** jako viditelný text ("Skladem" / "Nedostupné")
5. **Popis produktu** — min. 150 slov pro SEO, unikátní, ne copy-paste od výrobce
6. **Atributy/specifikace** — barva, materiál, velikosti, hmotnost — strukturovaně
7. **Varianty** — VŠECHNY varianty jako viditelný HTML (ne pouze v JS dropdown)
8. **Obrázky s alt texty** — každý obrázek musí mít popisný alt text
9. **Recenze/hodnocení** — pokud existují
10. **Související produkty** — interní prolinkování

#### 2.2.2 Varianty v HTML — KRITICKÉ pro agenty

```html
<!-- ŠPATNĚ — agent tohle nevidí -->
<select id="size-selector">
  <option value="39">39</option>
  <option value="40">40</option>
</select>

<!-- SPRÁVNĚ — agent vidí všechny varianty -->
<div role="radiogroup" aria-label="Velikost">
  <div data-variant-id="var-39" data-available="true">
    <span>39</span> <span>Skladem</span> <span>1 299 Kč</span>
  </div>
  <div data-variant-id="var-40" data-available="false">
    <span>40</span> <span>Nedostupné</span>
  </div>
  <!-- ... všechny varianty -->
</div>
```

### 2.3 Rychlost a Core Web Vitals

- **LCP < 2.5s** — hlavní obrázek produktu s `priority` loading
- **FID < 100ms** — minimální JavaScript na prvním renderování
- **CLS < 0.1** — explicitní rozměry na všech obrázcích (`width`, `height`)
- Next.js `<Image>` komponenta s `sizes` atributem
- Fonty s `font-display: swap`
- Komprese obrázků (WebP s JPEG fallbackem)

### 2.4 Interní prolinkování

- Breadcrumby na každé stránce
- "Související produkty" sekce na produktových stránkách
- Kategorie v navigaci jako crawlovatelné HTML linky (ne JS-only navigace)
- Footer s odkazy na hlavní kategorie a statické stránky

---

## 3. Část B: Agent-First vrstva — Structured Data {#3-agent-first-structured-data}

### 3.1 JSON-LD — srdce agent-first přístupu

JSON-LD (JavaScript Object Notation for Linked Data) je strojově čitelný popis obsahu stránky podle schema.org slovníku. Agent ho přečte okamžitě, bez parsování HTML.

**IMPLEMENTOVAT JAKO SERVER COMPONENT** — JSON-LD musí být ve výstupu `generateMetadata` nebo jako `<script>` v server-renderovaném HTML, NE v client componentu.

#### 3.1.1 Produktová stránka — kompletní JSON-LD

```tsx
// components/seo/ProductJsonLd.tsx
export function ProductJsonLd({ product, variants, reviews }: ProductJsonLdProps) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": product.name,
    "description": product.description,
    "sku": product.sku || product.variants[0]?.sku,
    "gtin13": product.ean || undefined,   // EAN kód, pokud existuje
    "mpn": product.mpn || undefined,       // Manufacturer Part Number

    "brand": {
      "@type": "Brand",
      "name": product.brand || STORE_NAME,
    },

    "category": product.category?.name,
    "material": product.attributes?.material,
    "color": product.attributes?.color,
    "weight": product.weight ? {
      "@type": "QuantitativeValue",
      "value": product.weight.value,
      "unitCode": product.weight.unit, // "KGM" pro kg, "GRM" pro g
    } : undefined,

    "image": product.images.map(img => img.url),
    "url": `${BASE_URL}/products/${product.slug}`,

    // VARIANTY — každá varianta jako samostatný ProductModel
    "hasVariant": variants.map(variant => ({
      "@type": "ProductModel",
      "name": `${product.name} — ${variant.name}`,
      "sku": variant.sku,
      "color": variant.attributes?.color,
      "size": variant.attributes?.size,
      "image": variant.images?.[0]?.url || product.images[0]?.url,
      "offers": {
        "@type": "Offer",
        "url": `${BASE_URL}/products/${product.slug}?variant=${variant.id}`,
        "priceCurrency": variant.pricing.currency,
        "price": variant.pricing.gross.amount,
        "priceValidUntil": getNextYearDate(), // Doporučeno Google
        "availability": variant.quantityAvailable > 0
          ? "https://schema.org/InStock"
          : "https://schema.org/OutOfStock",
        "itemCondition": "https://schema.org/NewCondition",
        "seller": {
          "@type": "Organization",
          "name": STORE_NAME,
        },
      },
    })),

    // Agregovaná nabídka
    "offers": {
      "@type": "AggregateOffer",
      "priceCurrency": product.pricing.currency,
      "lowPrice": product.pricing.priceRange.start.gross.amount,
      "highPrice": product.pricing.priceRange.stop.gross.amount,
      "offerCount": variants.length,
      "availability": variants.some(v => v.quantityAvailable > 0)
        ? "https://schema.org/InStock"
        : "https://schema.org/OutOfStock",
      "seller": {
        "@type": "Organization",
        "name": STORE_NAME,
      },
      "shippingDetails": {
        "@type": "OfferShippingDetails",
        "shippingRate": {
          "@type": "MonetaryAmount",
          "value": SHIPPING_COST,
          "currency": DEFAULT_CURRENCY,
        },
        "shippingDestination": {
          "@type": "DefinedRegion",
          "addressCountry": "CZ",
        },
        "deliveryTime": {
          "@type": "ShippingDeliveryTime",
          "handlingTime": {
            "@type": "QuantitativeValue",
            "minValue": 0,
            "maxValue": 1,
            "unitCode": "DAY",
          },
          "transitTime": {
            "@type": "QuantitativeValue",
            "minValue": 1,
            "maxValue": 3,
            "unitCode": "DAY",
          },
        },
      },
      "hasMerchantReturnPolicy": {
        "@type": "MerchantReturnPolicy",
        "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
        "merchantReturnDays": 14,
        "returnMethod": "https://schema.org/ReturnByMail",
        "returnFees": "https://schema.org/FreeReturn",
      },
    },

    // RECENZE — pokud existují
    ...(reviews && reviews.length > 0 ? {
      "aggregateRating": {
        "@type": "AggregateRating",
        "ratingValue": calculateAverageRating(reviews),
        "reviewCount": reviews.length,
        "bestRating": 5,
        "worstRating": 1,
      },
      "review": reviews.slice(0, 5).map(review => ({
        "@type": "Review",
        "author": {
          "@type": "Person",
          "name": review.authorName,
        },
        "datePublished": review.createdAt,
        "reviewRating": {
          "@type": "Rating",
          "ratingValue": review.rating,
          "bestRating": 5,
          "worstRating": 1,
        },
        "reviewBody": review.content,
      })),
    } : {}),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
```

#### 3.1.2 Breadcrumb JSON-LD

```tsx
export function BreadcrumbJsonLd({ items }: { items: BreadcrumbItem[] }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": items.map((item, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": item.name,
      "item": item.url ? `${BASE_URL}${item.url}` : undefined,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
```

#### 3.1.3 Organization JSON-LD (hlavní stránka)

```tsx
export function OrganizationJsonLd() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": STORE_NAME,
    "url": BASE_URL,
    "logo": `${BASE_URL}/logo.png`,
    "contactPoint": {
      "@type": "ContactPoint",
      "telephone": STORE_PHONE,
      "contactType": "customer service",
      "availableLanguage": ["Czech", "English"],
    },
    "sameAs": [
      SOCIAL_FACEBOOK,
      SOCIAL_INSTAGRAM,
    ].filter(Boolean),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
```

#### 3.1.4 WebSite JSON-LD se SearchAction

```tsx
export function WebSiteJsonLd() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": STORE_NAME,
    "url": BASE_URL,
    "potentialAction": {
      "@type": "SearchAction",
      "target": {
        "@type": "EntryPoint",
        "urlTemplate": `${BASE_URL}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
```

#### 3.1.5 Katalogová stránka (kategorie) — ItemList JSON-LD

```tsx
export function CategoryJsonLd({ category, products }: CategoryJsonLdProps) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": category.name,
    "description": category.description,
    "url": `${BASE_URL}/categories/${category.slug}`,
    "mainEntity": {
      "@type": "ItemList",
      "numberOfItems": products.totalCount,
      "itemListElement": products.edges.map((edge, index) => ({
        "@type": "ListItem",
        "position": index + 1,
        "url": `${BASE_URL}/products/${edge.node.slug}`,
        "name": edge.node.name,
        "image": edge.node.thumbnail?.url,
      })),
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
    />
  );
}
```

### 3.2 JSON-LD checklist

Pro každý typ stránky:

| Stránka | JSON-LD typy |
|---|---|
| Hlavní stránka | Organization + WebSite (se SearchAction) |
| Produktová stránka | Product (s variantami, cenami, dostupností, recenzemi) + BreadcrumbList |
| Kategorie | CollectionPage + ItemList + BreadcrumbList |
| Kolekce | CollectionPage + ItemList + BreadcrumbList |
| O nás | AboutPage + Organization |
| Kontakt | ContactPage + Organization |
| FAQ | FAQPage |

### 3.3 Saleor → JSON-LD mapování

Utility funkce pro konverzi Saleor GraphQL dat na schema.org:

```tsx
// lib/seo/saleor-to-jsonld.ts
export function mapSaleorProductToJsonLd(
  product: SaleorProduct,
  channel: string
): SchemaOrgProduct {
  // Mapování Saleor atributů → schema.org properties
  const attributeMap: Record<string, string> = {
    'brand': 'brand',
    'material': 'material',
    'color': 'color',
    'size': 'size',
    'weight': 'weight',
  };

  // Extrahovat atributy z Saleor product.attributes
  const mappedAttributes = product.attributes.reduce((acc, attr) => {
    const schemaKey = attributeMap[attr.attribute.slug];
    if (schemaKey && attr.values.length > 0) {
      acc[schemaKey] = attr.values[0].name;
    }
    return acc;
  }, {} as Record<string, string>);

  // Mapování availability
  const isInStock = product.variants?.some(
    v => v.quantityAvailable && v.quantityAvailable > 0
  );

  return {
    name: product.name,
    description: product.description
      ? stripHtml(product.description)
      : undefined,
    sku: product.variants?.[0]?.sku,
    brand: mappedAttributes.brand,
    category: product.category?.name,
    ...mappedAttributes,
    availability: isInStock
      ? 'https://schema.org/InStock'
      : 'https://schema.org/OutOfStock',
    // ... atd.
  };
}
```

---

## 4. Část C: llms.txt a agent manifest {#4-llms-txt}

### 4.1 llms.txt

Soubor na kořenové URL (`/llms.txt`) ve formátu Markdown. Popisuje eshop pro AI agenty.

```markdown
# {Store Name}

> Online eshop nabízející {popis sortimentu}. {Stručný tagline}.

## Produkty

Katalog produktů je dostupný na následujících URL:
- [Všechny produkty]({BASE_URL}/products): Kompletní katalog
- [Kategorie]({BASE_URL}/categories): Produkty organizované podle kategorií

## Strukturovaná data

Každá produktová stránka obsahuje kompletní JSON-LD markup (schema.org/Product)
s cenami, dostupností, variantami a recenzemi.

## Pro AI agenty

- [MCP Server endpoint]({BASE_URL}/mcp): Model Context Protocol server
  pro strukturovaný přístup k produktovým datům
- [Produktový feed (JSON)]({BASE_URL}/api/products/feed.json):
  Strojově čitelný feed všech produktů
- GraphQL API pro veřejné dotazy: {SALEOR_API_URL}

## Obchodní informace

- Doprava: {popis dopravy}
- Vrácení: 14 dní bez udání důvodu
- Kontakt: {email}, {telefon}

## Stránky

- [O nás]({BASE_URL}/pages/about)
- [Obchodní podmínky]({BASE_URL}/pages/terms)
- [Reklamační řád]({BASE_URL}/pages/returns)
- [Kontakt]({BASE_URL}/pages/contact)
```

### 4.2 llms-full.txt

Rozšířená verze s kompletním obsahem všech stránek (generovat automaticky).

### 4.3 Implementace v Next.js

```tsx
// app/llms.txt/route.ts
export async function GET() {
  const products = await getAllProducts();
  const categories = await getAllCategories();

  const content = generateLlmsTxt({ products, categories });

  return new Response(content, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=86400', // 24h cache
    },
  });
}
```

### 4.4 Produktový JSON feed

```tsx
// app/api/products/feed.json/route.ts
export async function GET() {
  const products = await getAllProductsWithVariants();

  const feed = products.map(p => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    url: `${BASE_URL}/products/${p.slug}`,
    category: p.category?.name,
    brand: extractAttribute(p, 'brand'),
    description: stripHtml(p.description),
    price: {
      currency: p.pricing?.priceRange?.start?.gross?.currency,
      min: p.pricing?.priceRange?.start?.gross?.amount,
      max: p.pricing?.priceRange?.stop?.gross?.amount,
    },
    inStock: p.isAvailable,
    variants: p.variants?.map(v => ({
      id: v.id,
      sku: v.sku,
      name: v.name,
      price: v.pricing?.price?.gross?.amount,
      inStock: (v.quantityAvailable ?? 0) > 0,
      attributes: v.attributes?.reduce((acc, a) => {
        acc[a.attribute.slug] = a.values[0]?.name;
        return acc;
      }, {} as Record<string, string>),
    })),
    images: p.images?.map(img => ({ url: img.url, alt: img.alt })),
    attributes: p.attributes?.reduce((acc, a) => {
      acc[a.attribute.slug] = a.values.map(v => v.name);
      return acc;
    }, {} as Record<string, string[]>),
    updatedAt: p.updatedAt,
  }));

  return Response.json(feed, {
    headers: {
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
```

---

## 5. Část D: MCP Server — Veřejná vrstva (read-only) {#5-mcp-public}

### 5.1 Přehled

MCP (Model Context Protocol) server vystaví Saleor GraphQL API jako sadu nástrojů (tools), které může AI agent volat přímo — bez parsování HTML. Veřejná vrstva je ekvivalent nepřihlášeného uživatele na webu.

**Technologie:** Node.js + `@modelcontextprotocol/sdk` (MCP SDK)
**Transport:** SSE (Server-Sent Events) na endpointu `{BASE_URL}/mcp`
**Autorizace:** Žádná — read-only přístup k veřejným datům

### 5.2 Seznam veřejných MCP nástrojů

```typescript
// mcp-server/tools/public.ts

// === VYHLEDÁVÁNÍ A BROWSING ===

/**
 * search_products
 * Vyhledá produkty podle textového dotazu.
 */
{
  name: "search_products",
  description: "Search for products by text query. Returns product names, prices, availability, and URLs.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Search query text" },
      first: { type: "number", description: "Number of results (default 10, max 50)", default: 10 },
      sortBy: {
        type: "string",
        enum: ["NAME", "PRICE", "RATING", "DATE", "RELEVANCE"],
        default: "RELEVANCE"
      },
      channel: { type: "string", description: "Sales channel slug", default: "default-channel" },
    },
    required: ["query"],
  }
}

/**
 * list_categories
 * Vrátí strom kategorií s počty produktů.
 */
{
  name: "list_categories",
  description: "List all product categories with product counts and hierarchy.",
  inputSchema: {
    type: "object",
    properties: {
      channel: { type: "string", default: "default-channel" },
    },
  }
}

/**
 * get_category_products
 * Vrátí produkty v dané kategorii s možností filtrování.
 */
{
  name: "get_category_products",
  description: "Get products in a specific category with filtering options.",
  inputSchema: {
    type: "object",
    properties: {
      categorySlug: { type: "string", description: "Category URL slug" },
      first: { type: "number", default: 10 },
      priceRange: {
        type: "object",
        properties: {
          gte: { type: "number", description: "Minimum price" },
          lte: { type: "number", description: "Maximum price" },
        }
      },
      attributes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            slug: { type: "string" },
            values: { type: "array", items: { type: "string" } },
          }
        },
        description: "Filter by product attributes (e.g., color, size)"
      },
      sortBy: { type: "string", enum: ["NAME", "PRICE", "DATE"], default: "NAME" },
      channel: { type: "string", default: "default-channel" },
    },
    required: ["categorySlug"],
  }
}

/**
 * get_product_detail
 * Vrátí kompletní detail produktu včetně všech variant.
 */
{
  name: "get_product_detail",
  description: "Get complete product details including all variants with prices, availability, attributes, images, and reviews.",
  inputSchema: {
    type: "object",
    properties: {
      slug: { type: "string", description: "Product URL slug" },
      channel: { type: "string", default: "default-channel" },
    },
    required: ["slug"],
  }
}

/**
 * get_variant_availability
 * Kontrola dostupnosti konkrétní varianty (barva + velikost).
 */
{
  name: "get_variant_availability",
  description: "Check real-time availability and pricing for a specific product variant.",
  inputSchema: {
    type: "object",
    properties: {
      variantId: { type: "string", description: "Variant ID" },
      channel: { type: "string", default: "default-channel" },
    },
    required: ["variantId"],
  }
}

/**
 * compare_products
 * Porovná 2–5 produktů vedle sebe.
 */
{
  name: "compare_products",
  description: "Compare 2-5 products side by side. Returns a comparison table with prices, ratings, key attributes, and availability.",
  inputSchema: {
    type: "object",
    properties: {
      slugs: {
        type: "array",
        items: { type: "string" },
        minItems: 2,
        maxItems: 5,
        description: "Product slugs to compare"
      },
      channel: { type: "string", default: "default-channel" },
    },
    required: ["slugs"],
  }
}

// === INFORMAČNÍ ===

/**
 * get_shipping_methods
 * Vrátí dostupné metody dopravy a jejich ceny.
 */
{
  name: "get_shipping_methods",
  description: "Get available shipping methods and their costs for a given country.",
  inputSchema: {
    type: "object",
    properties: {
      countryCode: { type: "string", description: "ISO 3166-1 alpha-2 country code", default: "CZ" },
      channel: { type: "string", default: "default-channel" },
    },
  }
}

/**
 * get_store_info
 * Vrátí informace o obchodě — kontakt, obchodní podmínky, otevírací doba.
 */
{
  name: "get_store_info",
  description: "Get store information: contact details, business hours, return policy, payment methods.",
  inputSchema: {
    type: "object",
    properties: {},
  }
}

/**
 * get_collections
 * Vrátí kolekce (sezónní nabídky, akce, výprodej).
 */
{
  name: "get_collections",
  description: "Get product collections (seasonal offers, sales, featured).",
  inputSchema: {
    type: "object",
    properties: {
      channel: { type: "string", default: "default-channel" },
    },
  }
}
```

### 5.3 Implementace MCP serveru

```typescript
// mcp-server/index.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createSaleorClient } from "./saleor-client.js";

const server = new McpServer({
  name: "saleor-storefront",
  version: "1.0.0",
});

const saleor = createSaleorClient(process.env.SALEOR_API_URL!);

// Registrace nástrojů
server.tool("search_products", searchProductsSchema, async (args) => {
  const result = await saleor.query(SEARCH_PRODUCTS_QUERY, {
    search: args.query,
    first: args.first,
    sortBy: { field: args.sortBy, direction: "ASC" },
    channel: args.channel,
  });

  return {
    content: [{
      type: "text",
      text: JSON.stringify(formatProductList(result.data.products), null, 2),
    }],
  };
});

// ... registrace všech nástrojů

// SSE transport pro Next.js API route
export { server };
```

### 5.4 Integrace s Next.js

```tsx
// app/mcp/route.ts
import { server } from "@/mcp-server";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

export async function GET(request: Request) {
  const transport = new SSEServerTransport("/mcp", response);
  await server.connect(transport);
  // ... SSE handling
}

export async function POST(request: Request) {
  // Handle MCP JSON-RPC messages
}
```

### 5.5 GraphQL queries pro veřejné nástroje

```graphql
# Vyhledávání produktů
query SearchProducts($search: String!, $first: Int!, $channel: String!) {
  products(
    filter: { search: $search }
    first: $first
    channel: $channel
  ) {
    edges {
      node {
        id
        name
        slug
        description
        category { name slug }
        pricing {
          priceRange {
            start { gross { amount currency } }
            stop { gross { amount currency } }
          }
        }
        isAvailable
        thumbnail { url alt }
        variants {
          id
          name
          sku
          quantityAvailable
          pricing { price { gross { amount currency } } }
          attributes {
            attribute { slug name }
            values { name }
          }
        }
        attributes {
          attribute { slug name }
          values { name }
        }
      }
    }
    totalCount
  }
}

# Detail produktu
query ProductDetail($slug: String!, $channel: String!) {
  product(slug: $slug, channel: $channel) {
    id
    name
    slug
    description
    seoTitle
    seoDescription
    category { name slug }
    productType { name }
    pricing {
      priceRange {
        start { gross { amount currency } }
        stop { gross { amount currency } }
      }
    }
    isAvailable
    images { url alt }
    variants {
      id
      name
      sku
      quantityAvailable
      pricing { price { gross { amount currency } } }
      attributes {
        attribute { slug name }
        values { name slug }
      }
      images { url alt }
    }
    attributes {
      attribute { slug name inputType }
      values { name slug file { url } }
    }
    metadata { key value }
  }
}
```

---

## 6. Část E: MCP Server — Uživatelská vrstva (authenticated) {#6-mcp-authenticated}

### 6.1 Přehled

Autentizovaná vrstva umožňuje agentovi jednat za přihlášeného uživatele — přidávat do košíku, spravovat adresář, provádět checkout. Vyžaduje OAuth 2.0 autorizaci.

### 6.2 Autorizační flow

```
1. Agent požádá o přístup → MCP server vrátí OAuth authorization URL
2. Uživatel se přihlásí v prohlížeči a schválí přístup
3. MCP server obdrží authorization code → vymění za Saleor access token
4. Agent následně volá authenticated tools s platným tokenem
```

Saleor podporuje JWT tokeny přes `tokenCreate` mutation nebo OIDC. MCP server bude fungovat jako OAuth 2.0 provider, který interně používá Saleor `tokenCreate` / `tokenRefresh`.

### 6.3 Seznam authenticated MCP nástrojů

```typescript
// === KOŠÍK ===

/**
 * create_checkout
 * Vytvoří nový košík (checkout session).
 */
{
  name: "create_checkout",
  description: "Create a new shopping cart. Returns checkout ID for subsequent operations.",
  inputSchema: {
    type: "object",
    properties: {
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            variantId: { type: "string" },
            quantity: { type: "number", minimum: 1 },
          },
          required: ["variantId", "quantity"],
        },
        description: "Items to add to cart"
      },
      channel: { type: "string", default: "default-channel" },
    },
    required: ["lines"],
  }
}

/**
 * add_to_cart
 * Přidá položku do existujícího košíku.
 */
{
  name: "add_to_cart",
  description: "Add an item to an existing cart.",
  inputSchema: {
    type: "object",
    properties: {
      checkoutId: { type: "string" },
      variantId: { type: "string" },
      quantity: { type: "number", minimum: 1, default: 1 },
    },
    required: ["checkoutId", "variantId"],
  }
}

/**
 * update_cart_item
 * Změní množství položky v košíku.
 */
{
  name: "update_cart_item",
  description: "Update quantity of an item in the cart. Set quantity to 0 to remove.",
  inputSchema: {
    type: "object",
    properties: {
      checkoutId: { type: "string" },
      lineId: { type: "string" },
      quantity: { type: "number", minimum: 0 },
    },
    required: ["checkoutId", "lineId", "quantity"],
  }
}

/**
 * get_cart
 * Zobrazí obsah košíku s cenami a souhrnem.
 */
{
  name: "get_cart",
  description: "Get current cart contents with prices, subtotal, shipping, and total.",
  inputSchema: {
    type: "object",
    properties: {
      checkoutId: { type: "string" },
    },
    required: ["checkoutId"],
  }
}

// === CHECKOUT ===

/**
 * set_shipping_address
 * Nastaví doručovací adresu. Může použít uloženou adresu z adresáře.
 */
{
  name: "set_shipping_address",
  description: "Set shipping address for checkout. Can use a saved address from user's address book.",
  inputSchema: {
    type: "object",
    properties: {
      checkoutId: { type: "string" },
      addressId: { type: "string", description: "Saved address ID (optional — if provided, other fields are ignored)" },
      address: {
        type: "object",
        properties: {
          firstName: { type: "string" },
          lastName: { type: "string" },
          streetAddress1: { type: "string" },
          streetAddress2: { type: "string" },
          city: { type: "string" },
          postalCode: { type: "string" },
          country: { type: "string", description: "ISO 3166-1 alpha-2" },
          phone: { type: "string" },
        },
        required: ["firstName", "lastName", "streetAddress1", "city", "postalCode", "country"],
      },
    },
    required: ["checkoutId"],
  }
}

/**
 * set_shipping_method
 * Vybere metodu dopravy.
 */
{
  name: "set_shipping_method",
  description: "Select a shipping method. Call get_available_shipping_methods first to see options.",
  inputSchema: {
    type: "object",
    properties: {
      checkoutId: { type: "string" },
      shippingMethodId: { type: "string" },
    },
    required: ["checkoutId", "shippingMethodId"],
  }
}

/**
 * get_available_shipping_methods
 * Vrátí dostupné metody dopravy pro aktuální checkout (závisí na adrese).
 */
{
  name: "get_available_shipping_methods",
  description: "Get available shipping methods for the current checkout based on the shipping address.",
  inputSchema: {
    type: "object",
    properties: {
      checkoutId: { type: "string" },
    },
    required: ["checkoutId"],
  }
}

/**
 * complete_checkout
 * Dokončí objednávku. Pokud má uživatel uloženou platební metodu, použije ji.
 */
{
  name: "complete_checkout",
  description: "Complete the checkout and place the order. Requires shipping address and method to be set. If user has a saved payment method, it will be used.",
  inputSchema: {
    type: "object",
    properties: {
      checkoutId: { type: "string" },
      paymentMethodId: { type: "string", description: "Saved payment method ID (optional)" },
    },
    required: ["checkoutId"],
  }
}

// === UŽIVATELSKÝ ÚČET ===

/**
 * get_my_orders
 * Vrátí historii objednávek.
 */
{
  name: "get_my_orders",
  description: "Get order history for the authenticated user.",
  inputSchema: {
    type: "object",
    properties: {
      first: { type: "number", default: 10 },
    },
  }
}

/**
 * get_order_detail
 * Vrátí detail konkrétní objednávky včetně stavu dopravy.
 */
{
  name: "get_order_detail",
  description: "Get details of a specific order including shipping status.",
  inputSchema: {
    type: "object",
    properties: {
      orderId: { type: "string" },
    },
    required: ["orderId"],
  }
}

/**
 * get_my_addresses
 * Vrátí uložené adresy z adresáře.
 */
{
  name: "get_my_addresses",
  description: "Get saved addresses from the user's address book.",
  inputSchema: {
    type: "object",
    properties: {},
  }
}

/**
 * get_my_wishlist
 * Vrátí položky z wishlistu (pokud je implementován přes metadata).
 */
{
  name: "get_my_wishlist",
  description: "Get items from the user's wishlist.",
  inputSchema: {
    type: "object",
    properties: {},
  }
}
```

### 6.4 GraphQL mutations pro authenticated nástroje

```graphql
# Vytvoření košíku
mutation CheckoutCreate($input: CheckoutCreateInput!) {
  checkoutCreate(input: $input) {
    checkout {
      id
      lines {
        id
        variant { name sku }
        quantity
        totalPrice { gross { amount currency } }
      }
      totalPrice { gross { amount currency } }
    }
    errors { field message code }
  }
}

# Přidání do košíku
mutation CheckoutLinesAdd($checkoutId: ID!, $lines: [CheckoutLineInput!]!) {
  checkoutLinesAdd(id: $checkoutId, lines: $lines) {
    checkout {
      id
      lines {
        id
        variant { name sku }
        quantity
        totalPrice { gross { amount currency } }
      }
      totalPrice { gross { amount currency } }
    }
    errors { field message code }
  }
}

# Nastavení adresy
mutation CheckoutShippingAddressUpdate($checkoutId: ID!, $address: AddressInput!) {
  checkoutShippingAddressUpdate(id: $checkoutId, shippingAddress: $address) {
    checkout {
      id
      shippingMethods {
        id
        name
        price { amount currency }
        minimumDeliveryDays
        maximumDeliveryDays
      }
    }
    errors { field message code }
  }
}

# Dokončení checkoutu
mutation CheckoutComplete($checkoutId: ID!) {
  checkoutComplete(id: $checkoutId) {
    order {
      id
      number
      status
      total { gross { amount currency } }
    }
    errors { field message code }
  }
}

# Historie objednávek (vyžaduje autentizaci)
query MyOrders($first: Int!) {
  me {
    orders(first: $first) {
      edges {
        node {
          id
          number
          created
          status
          total { gross { amount currency } }
          lines {
            productName
            variantName
            quantity
            unitPrice { gross { amount currency } }
          }
        }
      }
    }
  }
}
```

---

## 7. Část F: Bezpečnost a autorizace {#7-bezpecnost}

### 7.1 Dvouvrstvý model

```
┌─────────────────────────────────────────────┐
│             MCP Server                       │
│                                             │
│  ┌──────────────────┐  ┌─────────────────┐ │
│  │ PUBLIC TOOLS      │  │ AUTH TOOLS      │ │
│  │                  │  │                 │ │
│  │ search_products  │  │ create_checkout │ │
│  │ get_product      │  │ add_to_cart     │ │
│  │ list_categories  │  │ checkout        │ │
│  │ get_store_info   │  │ get_my_orders   │ │
│  │                  │  │                 │ │
│  │ → Saleor Public  │  │ → Saleor +      │ │
│  │   GraphQL        │  │   Bearer Token  │ │
│  │   (no auth)      │  │   (user JWT)    │ │
│  └──────────────────┘  └─────────────────┘ │
└─────────────────────────────────────────────┘
```

### 7.2 Co NESMÍ být přístupné

**KRITICKÉ:** Admin operace Saleor API nesmí být nikdy exponované přes MCP:

- `staffCreate`, `staffUpdate`, `staffDelete`
- `productCreate`, `productUpdate`, `productDelete`
- `orderUpdate`, `orderCancel` (admin verze)
- `channelCreate`, `channelUpdate`
- `permissionGroupCreate`, `permissionGroupUpdate`
- `appCreate`, `appUpdate`
- Jakákoliv mutation s prefixem `staff*`, `app*`, `plugin*`, `warehouse*`
- Přístup k `privateMetadata`

### 7.3 Rate limiting

- Veřejné tools: 60 requestů / minutu / IP
- Authenticated tools: 120 requestů / minutu / uživatel
- Checkout/payment tools: 10 requestů / minutu / uživatel

### 7.4 OAuth 2.0 implementace

```typescript
// mcp-server/auth/oauth.ts

// MCP server vystaví tyto endpointy:
// GET  /mcp/authorize  — přesměruje na login stránku
// POST /mcp/token      — vymění authorization code za access token
// POST /mcp/revoke     — zruší token

// Interně mapuje na Saleor:
// tokenCreate(email, password) → JWT access + refresh token
// tokenRefresh(refreshToken)   → nový access token
// tokenVerify(token)           → validace

// MCP OAuth scopes:
const SCOPES = {
  "read:products": "Přístup k produktovým datům (veřejné)",
  "read:account": "Přístup k uživatelskému účtu",
  "write:cart": "Správa košíku",
  "write:checkout": "Dokončení objednávky",
  "read:orders": "Historie objednávek",
  "write:addresses": "Správa adresáře",
};
```

---

## 8. Část G: Testování a validace {#8-testovani}

### 8.1 SEO validace

| Test | Nástroj | Očekávaný výsledek |
|---|---|---|
| JSON-LD validace | Google Rich Results Test | Bez chyb, všechna pole vyplněná |
| Schema.org validace | schema.org/validation | Valid |
| Meta tagy | Screaming Frog / Lighthouse | Každá stránka má unikátní title + description |
| Core Web Vitals | PageSpeed Insights | LCP < 2.5s, FID < 100ms, CLS < 0.1 |
| Mobile friendliness | Google Mobile-Friendly Test | Pass |
| Sitemap | Manuálně | Všechny produkty, kategorie, stránky |
| robots.txt | Manuálně | Admin/checkout/api blokované |
| Kanonické URL | Screaming Frog | Žádné duplicity |
| Heading hierarchie | Lighthouse Accessibility | Jeden H1, logická struktura |

### 8.2 Agent-first validace

| Test | Jak testovat | Očekávaný výsledek |
|---|---|---|
| HTML bez JS | `curl -s URL \| grep "application/ld+json"` | JSON-LD blok přítomen |
| Produktová data v HTML | `curl -s URL \| grep "Skladem\|OutOfStock"` | Dostupnost v textu |
| Varianty v HTML | `curl -s URL \| grep "data-variant-id"` | Všechny varianty přítomny |
| JSON feed | `curl -s /api/products/feed.json \| jq '.length'` | Počet produktů |
| llms.txt | `curl -s /llms.txt` | Validní markdown |
| MCP server health | `curl -s /mcp/health` | `{"status": "ok"}` |

### 8.3 MCP validace

```bash
# Testování veřejných nástrojů
npx @modelcontextprotocol/inspector http://localhost:3000/mcp

# Ověření, že admin operace nejsou dostupné
# Inspector by neměl zobrazit žádné admin tools
```

### 8.4 Simulace agentního přístupu

Testovací skript, který simuluje, jak agent prochází eshop:

```typescript
// tests/agent-simulation.test.ts
describe("Agent flow simulation", () => {
  it("should find product via search → detail → variant check", async () => {
    // 1. Simulace web_search
    const searchResults = await fetch("/api/products/feed.json");
    const products = await searchResults.json();
    expect(products.length).toBeGreaterThan(0);

    // 2. Simulace web_fetch na produktovou stránku
    const html = await fetch(`/products/${products[0].slug}`);
    const text = await html.text();

    // 3. Ověření JSON-LD
    const jsonLdMatch = text.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
    expect(jsonLdMatch).toBeTruthy();
    const jsonLd = JSON.parse(jsonLdMatch![1]);
    expect(jsonLd["@type"]).toBe("Product");
    expect(jsonLd.offers).toBeDefined();
    expect(jsonLd.hasVariant).toBeDefined();

    // 4. MCP tool test
    const mcpResult = await callMcpTool("get_product_detail", {
      slug: products[0].slug,
    });
    expect(mcpResult.name).toBe(products[0].name);
    expect(mcpResult.variants.length).toBeGreaterThan(0);
  });
});
```

---

## 9. Přílohy {#9-prilohy}

### 9.1 Referenční materiály

- **Saleor API reference:** https://docs.saleor.io/api-reference/
- **Saleor storefront (Paper):** https://github.com/saleor/storefront
- **Schema.org Product:** https://schema.org/Product
- **MCP specification:** https://modelcontextprotocol.io/
- **llms.txt specification:** https://llmstxt.org/
- **Google UCP (Universal Commerce Protocol):** https://ucp.dev/
- **Shopify MCP UI:** https://shopify.engineering/mcp-ui-breaking-the-text-wall

### 9.2 Relevantní standardy a protokoly

| Standard | Účel | Status (2026) |
|---|---|---|
| schema.org JSON-LD | Strukturovaná data v HTML | Stabilní, všichni agenti |
| llms.txt | Manifest pro LLM agenty | Navrhovaný, ~850k webů |
| MCP (Model Context Protocol) | Nativní tool-based přístup | Rostoucí adopce |
| UCP (Google) | Univerzální commerce protokol | Nový (Q1 2026), podpora MCP |
| Shopify MCP-UI | Interaktivní UI v agentech | Experimentální |

### 9.3 Saleor Public vs Admin API operace

**Public (použít v MCP public tools):**
- `products`, `product` (queries)
- `categories`, `category`
- `collections`, `collection`
- `checkoutCreate`, `checkoutLinesAdd`, `checkoutLinesUpdate`
- `checkoutShippingAddressUpdate`, `checkoutBillingAddressUpdate`
- `checkoutDeliveryMethodUpdate`
- `checkoutComplete`
- `checkoutPaymentCreate`
- `tokenCreate`, `tokenRefresh`, `tokenVerify`

**Admin (NIKDY v MCP):**
- `productCreate`, `productUpdate`, `productDelete`
- `orderCreate`, `orderUpdate`
- `staffCreate`, `staffUpdate`
- `channelCreate`, `channelUpdate`
- `permissionGroupCreate`
- Cokoliv vyžadující App Token nebo Staff permissions

### 9.4 Konfigurace prostředí

```env
# .env.local
NEXT_PUBLIC_SALEOR_API_URL=https://your-instance.saleor.cloud/graphql/
NEXT_PUBLIC_DEFAULT_CHANNEL=default-channel
NEXT_PUBLIC_BASE_URL=https://your-store.com
NEXT_PUBLIC_STORE_NAME="Název Obchodu"

# MCP Server
MCP_SERVER_PORT=3001
MCP_RATE_LIMIT_PUBLIC=60
MCP_RATE_LIMIT_AUTH=120

# SEO
DEFAULT_CURRENCY=CZK
SHIPPING_COST=0
STORE_PHONE="+420..."
SOCIAL_FACEBOOK=https://facebook.com/...
SOCIAL_INSTAGRAM=https://instagram.com/...
```

---

> **Poznámka pro implementujícího agenta:** Tento dokument je kompletní zadání. Implementuj sekce v pořadí: nejprve Část A (klasické SEO), pak Část B (JSON-LD), pak C (llms.txt), a nakonec D+E (MCP server). Každou část testuj podle Části G před pokračováním na další.
