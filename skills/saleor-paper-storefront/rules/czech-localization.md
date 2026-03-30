# Czech Localization

How to work with the i18n system in this storefront. Uses `next-intl` with cookie-based locale detection (no URL prefix).

---

## Architecture

```
src/i18n/config.ts          — Locale type, available locales ['cs', 'en'], default 'cs'
src/i18n/request.ts         — Server-side locale detection (cookie → Accept-Language → default)
src/middleware.ts            — Sets NEXT_LOCALE cookie if not present
src/messages/cs.json        — Czech translations (~200+ keys)
src/messages/en.json        — English translations (same structure)
src/config/locale.ts        — Formatting helpers (formatPrice, formatDate), graphqlLanguageCode mapping
src/ui/components/locale-switcher.tsx — CS/EN toggle component
```

## Key Patterns

### Server Components
```tsx
import { getTranslations } from "next-intl/server";

export default async function Page() {
  const t = await getTranslations("namespace");
  return <h1>{t("key")}</h1>;
}
```

### Client Components
```tsx
"use client";
import { useTranslations } from "next-intl";

export function Component() {
  const t = useTranslations("namespace");
  return <button>{t("key")}</button>;
}
```

### Dynamic Values (ICU Message Format)
```tsx
t("greeting", { name: "Jan" })           // "Ahoj, {name}"
t("items", { count: 3 })                  // plural: "3 položky"
t("resultsFor", { query: searchTerm })    // "Výsledky pro „{query}""
```

## Translation Namespaces

| Namespace | Scope | Keys |
|-----------|-------|------|
| `common` | Generic UI (loading, save, cancel, etc.) | ~18 |
| `nav` | Navigation labels | ~6 |
| `auth` | Login, signup, password forms | ~20 |
| `cart` | Cart drawer | ~18 |
| `product` | Product pages | ~16 |
| `search` | Search results | ~6 |
| `account` | Account pages | ~30 |
| `checkout` | Entire checkout flow | ~70 |
| `address` | Address field labels | ~12 |
| `footer` | Footer links and labels | ~11 |
| `pagination` | Previous/Next | ~3 |

## Saleor GraphQL Language Code

The `graphqlLanguageCode` is mapped in `src/config/locale.ts`:
- `cs` → `"CS"` (Czech translations in Saleor)
- `en` → `"EN_US"` (English translations in Saleor)

**Prerequisite**: Saleor backend must have Czech language enabled and product translations created.

## Rules

1. **NEVER hardcode English strings** — always use translation keys
2. **Use the correct import** — `getTranslations` for Server Components, `useTranslations` for Client
3. **Add keys to BOTH json files** when adding new translations
4. **Use ICU format** for plurals and interpolation
5. **Keep keys organized** by namespace — don't dump everything into `common`
6. **Locale switcher** sets a cookie and calls `router.refresh()` — no page navigation needed
