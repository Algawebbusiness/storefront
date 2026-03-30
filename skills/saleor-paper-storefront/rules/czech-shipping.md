# Czech Shipping

Zásilkovna (Packeta) pickup point widget integration in the shipping step.

---

## Architecture

```
src/config/shipping.ts                                    — Config, method detection regex
src/checkout/components/shipping/zasilkovna-widget.tsx     — Pickup point widget component
global.d.ts                                               — PacketaPoint, Window.Packeta types
```

## How It Works

1. Shipping step renders methods from Saleor API as radio buttons
2. `isZasilkovnaMethod(name)` detects Zásilkovna by name pattern (`/zásilkovna|packeta|zásielkovňa/i`)
3. When a Zásilkovna method is selected, `ZasilkovnaWidget` renders below the radio button
4. Widget loads Packeta script from CDN and opens the pickup point picker
5. Selected point stored in checkout metadata (keys: `zasilkovna_point_id`, `zasilkovna_point_name`, `zasilkovna_point_address`)
6. Point selection is required before continuing to payment

## Packeta Widget API

```typescript
// Script: https://widget.packeta.com/v6/www/js/library.js
window.Packeta.Widget.pick(apiKey, callback, {
  country: "cz",
  language: "cs",
});
```

**Environment variable**: `NEXT_PUBLIC_ZASILKOVNA_API_KEY`

## PacketaPoint Type

```typescript
interface PacketaPoint {
  id: number;
  name: string;        // "Zásilkovna - Praha 1"
  nameStreet: string;   // "Vodičkova 30"
  zip: string;          // "11000"
  city: string;         // "Praha"
}
```

## Metadata Keys

| Key | Value | Example |
|-----|-------|---------|
| `zasilkovna_point_id` | Point ID | `"12345"` |
| `zasilkovna_point_name` | Point name | `"Zásilkovna - Praha 1"` |
| `zasilkovna_point_address` | Full address | `"Vodičkova 30, 11000 Praha"` |

## Adding Other Czech Carriers

To add PPL, Česká pošta, Balíkovna, or other carriers with pickup points:

1. Add detection pattern to `src/config/shipping.ts`
2. Create a widget component similar to `zasilkovna-widget.tsx`
3. Integrate into `shipping-step.tsx` with the same pattern

## Rules

1. **Always require pickup point** when Zásilkovna method is selected
2. **Load widget script lazily** — only when method is selected
3. **Store point in metadata** — not in address fields
4. **Handle script load failures** gracefully — show error message
5. **API key from env** — never hardcode
