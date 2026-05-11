# Agent registry — design doc (Phase B1)

> Schema and rationale for the agent identity layer that backs Phase B (signed
> request verification, audit log, spending caps, approval flow, OAuth binding,
> accepted-platforms publishing, abuse detection, and the legacy
> `AGENT_API_KEYS` migration).
>
> Types live in `src/lib/protocols/shared/agent-registry-types.ts`. The loader
> arrives in B2.

## Why this matters

Phase A made the storefront fluent in UCP 2026-04-08 — it can talk to agents,
sign its responses, and accept structured intent. But the auth model was still
a flat list of bearer tokens (`AGENT_API_KEYS=key1,key2`). For a production
deploy where agents spend real money on a merchant's behalf, that's not
enough. The merchant needs:

- **Identity** — who is this caller, not just "do they hold a token"
- **Cryptographic provenance** — every request signed, not just bearer-presented
- **Per-agent constraints** — scope, spending caps, rate limits
- **Audit** — who did what, when, with what outcome
- **Reversibility** — suspend a misbehaving agent without redeploying

The registry is the source of truth for all of this.

## Two storage backends, one API

The registry has two backends because the project ships before its full
admin UI does:

| Backend | When | What it gives the merchant |
|---------|------|----------------------------|
| Payload collection `Agents` | When Payload backend is deployed (Algaweb roadmap Phase 2) | Visual admin, per-tenant isolation, audit log UI, approval inbox, suspend/reactivate buttons |
| Env JSON `AGENT_REGISTRY_JSON` | Always works | Same data, edited by hand or by deploy automation |

The loader presents a single API (`getAgentById`, `listActiveAgents`) and
tries Payload first, env second. The rest of the protocols layer doesn't
know which backend served the agent record.

**Storefront ships fully functional today** with env-only mode. Payload is
purely an upgrade path for the merchant UX.

## Schema decisions

### Closed `AgentScope` enum

Scopes are an enum, not free-form strings. Adding a new scope is a deliberate
change to the security model — it should require touching the type, not just
adding a string in someone's `Agents` document. Compile-time enforcement that
every code path that gates on scope handles every scope value.

The initial nine scopes mirror the actions the protocol surface already
exposes (catalog read, cart CRUD, checkout flow, order read/return, customer
read/update). `customer.*` scopes only make sense paired with an OAuth2
user-scoped token — agent-level access can never grant them.

### `null`-able spending limits, mandatory rate limits

Spending caps are optional per window — `per_session_cents: null` means
"no per-session cap, only daily/monthly apply (or none if those are null
too)". Real-world setups will mix and match: an experimental agent might
get just a per-session cap; a production partner might get only a monthly
budget.

Rate limits are mandatory. Throughput is a security control, not a budget
choice — every agent must declare its expected request rate. Forces the
operator to think about it instead of accepting `Infinity` by default.

### `public_key` as raw base64, not JWK or PEM

Same wire format as the storefront's own `signing_keys[].public_key` from
A3 — base64-encoded raw 32 bytes. JWK is verbose; PEM has multiple
representations. Raw bytes are unambiguous and the Web Crypto importers
already handle this format (verified in `signing.test.ts`).

The `SYNTHETIC_LEGACY_AGENT` (B9) is the only allowed empty-string case —
its `public_key: ""` is the marker that this row represents the deprecated
bearer-token path, not a real keyed agent.

### Status: `active | suspended | revoked`

- `suspended` is *reversible*. B10 abuse detection can auto-set it; the
  merchant flips it back.
- `revoked` is *terminal*. Used when an agent platform is compromised or
  permanently delisted. Code paths that handle revoked agents may delete
  cached state more aggressively than for suspended.
- Distinction matters for B6: a suspended agent's pending approvals stay
  in the queue (might recover); a revoked agent's are auto-rejected.

### `AgentLookup` discriminated union

The loader returns `AgentLookup`, not `AgentIdentity | null`. The caller
needs to distinguish:

- "no such agent" → 401, log as auth failure
- "agent suspended" → 403, log as policy block, surface in admin
- "agent revoked" → 403 with a sharper message, do not retry

Callers that only care "can I serve this request" check
`found && isActiveAgent(agent)`. Callers that need richer behaviour
(audit log, abuse detection) use the `reason` discriminator.

## Things deliberately NOT in the schema

- **`api_key` / `api_secret`** — registry is signature-based. Bearer
  tokens live in env (`AGENT_API_KEYS`) only for the legacy migration
  window (B9, 180 days).
- **`allowed_redirect_uris`** — that's OAuth client config (B7), separate
  concern. The OAuth client → agent mapping is a thin lookup table.
- **`webhook_url`** — outbound notifications to the agent (e.g. approval
  decided) are a B6/B10 detail; route hangs off `agent.id`, not stored
  here.
- **`tenant_id`** — when running on Payload with multi-tenant plugin,
  tenant scoping is implicit on the document. Env mode is single-tenant.
  Don't duplicate the field.

## Versioning

This schema is v1. Future migrations (additional scopes, new limit
windows, structured contact info) will bump a version field on the
record itself, not break the type. For now, no version field — keep it
simple.

## Test plan (B2 onward)

- Unit: loader with mocked Payload + env fixtures. Cases: Payload hit,
  Payload miss → env hit, both miss, malformed env JSON.
- Integration: live Payload check is manual (Payload is not yet deployed).
- Round-trip: an agent registered via env can be matched by an incoming
  signed request (B3 verification).
