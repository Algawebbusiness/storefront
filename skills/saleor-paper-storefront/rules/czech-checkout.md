# Czech Checkout

Czech-specific checkout features: IČO/DIČ business fields and metadata storage.

---

## IČO/DIČ Fields

### Architecture

```
src/checkout/components/address-form/czech-business-fields.tsx  — UI component
src/checkout/lib/validators/czech.ts                            — Validation logic
src/checkout/graphql/checkout.graphql                           — metadata field + updateMetadata mutation
```

### How It Works

1. `CzechBusinessFields` component renders when `countryCode === "CZ"` AND `companyName` is non-empty
2. IČO (8 digits, modulo 11 checksum) and DIČ (CZ + 8-10 digits) are validated on blur
3. Values are stored in checkout metadata via `updateMetadata` mutation (keys: `ico`, `dic`)
4. Displayed in address display and order confirmation from `checkout.metadata`

### Validation Rules

```typescript
// IČO: exactly 8 digits, modulo 11 checksum
validateICO("12345678") // true/false

// DIČ: CZ prefix + 8-10 digits
validateDIC("CZ12345678") // true/false
```

### Metadata Storage

IČO/DIČ are NOT native Saleor Address fields. They are stored as checkout metadata:

```graphql
mutation UpdateCheckoutMetadata($id: ID!, $input: [MetadataInput!]!) {
  updateMetadata(id: $id, input: $input) {
    errors { field message }
    item { metadata { key value } }
  }
}
```

Keys: `ico`, `dic`

### Integration Points

- `information-step.tsx` — saves IČO/DIČ on form submit
- `address-display.tsx` — shows IČO/DIČ below company name (via `metadata` prop)
- `confirmation-step.tsx` — reads from `checkout.metadata`

## Rules

1. **IČO is required** when country is CZ and companyName is filled
2. **DIČ is optional** — not all Czech companies are VAT payers
3. **Always validate** IČO checksum, not just format
4. **Store in metadata**, not in address fields — Saleor Address type doesn't have these fields
5. **Display in order confirmation** — business customers need to see IČO/DIČ on their order
