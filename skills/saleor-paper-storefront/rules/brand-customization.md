# Brand Customization

How to customize the storefront for a new client. Change a few config values and CSS variables to get a completely different look.

---

## Quick Start for New Client

### Step 1: Brand Config (`src/config/brand.ts`)

```typescript
export const brandConfig = {
  siteName: "Květiny Jana",              // Site name in titles
  copyrightHolder: "Jana Nováková",      // Footer copyright
  organizationName: "Květiny Jana",      // JSON-LD
  defaultBrand: "Květiny Jana",          // Product fallback brand
  tagline: "Čerstvé květiny s doručením po celé ČR.",
  description: "Online květinářství s čerstvými kyticemi a dekoracemi.",
  logoAriaLabel: "Květiny Jana",
  titleTemplate: "%s | Květiny Jana",
  social: {
    twitter: null,
    instagram: "kvetiny.jana",
    facebook: "https://facebook.com/kvetinyjana",
  },
} as const;
```

### Step 2: Colors (`src/app/globals.css`)

The color system uses CSS custom properties. Look for the `:root` and `.dark` blocks:

```css
:root {
  --background: 0 0% 100%;           /* White background */
  --foreground: 20 14.3% 4.1%;       /* Near-black text */
  --primary: 142 76% 36%;            /* Green primary (for a flower shop) */
  --primary-foreground: 0 0% 100%;   /* White text on primary */
  /* ... other tokens */
}
```

**Key tokens to change per client:**
- `--primary` / `--primary-foreground` — brand color
- `--accent` / `--accent-foreground` — secondary accent
- `--background` / `--foreground` — page background and text

### Step 3: Logo

Replace files in `public/`:
- `public/logo.svg` or `public/logo.png`
- `public/favicon.ico`
- `public/apple-touch-icon.png`

### Step 4: Fonts (Optional)

Fonts are configured in `src/app/layout.tsx`:
```tsx
import { GeistSans } from "geist/font/sans";
```

To use a different font, install it via `pnpm add @next/font` or use Google Fonts.

### Step 5: Locale Default

In `src/i18n/config.ts`, the default locale is `"cs"`. Change if needed.

## Customization Zones in globals.css

The CSS file has these sections:
1. **Color tokens** (`:root` block) — brand colors, backgrounds, borders
2. **Dark mode** (`.dark` block) — dark theme overrides
3. **Typography** — font sizes, line heights
4. **Spacing** — custom spacing scale (if any)
5. **Border radius** — card/button roundness

## What NOT to Change

- Component structure in `src/ui/components/` — these are shared primitives
- Checkout flow in `src/checkout/` — business logic, not visual
- GraphQL queries — these are API contracts
- `tailwind.config.ts` — use CSS variables instead

## Per-Client Deployment

Each client gets their own fork/branch with:
1. Modified `brand.ts`
2. Modified `globals.css` colors
3. Logo files in `public/`
4. `.env` with their Saleor channel URL
5. Deploy to Cloudflare Pages / Vercel with `NEXT_PUBLIC_SALEOR_API_URL`
