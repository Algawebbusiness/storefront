# Migration: `AGENT_API_KEYS` → Agent Registry (Phase B9)

> **Audience:** Algaweb client running this storefront template. If you've never set `AGENT_API_KEYS`, you're already on the new flow — skip this doc.
>
> **Why:** The flat-token bearer auth (`AGENT_API_KEYS=key1,key2`) gives you no identity, no per-agent limits, no audit trail, and no way to suspend a single agent. The Agent Registry (Phase B1–B8) replaces it with signed requests, per-agent scope/limits/spending caps, full audit log, and a public `accepted_platforms` declaration in `/.well-known/ucp`.

## Timeline

The storefront ships **dual-mode** for **180 days** so existing deployments don't break:

| Day | What changes | What you should do |
|-----|--------------|-------------------|
| 0 (today) | Both flows work. Legacy bearer logs `[auth] DEPRECATED ...` warning on every call. | Read this doc. |
| 30 | Same as day 0. | Generate keys for your active agents. Test signed requests in staging. |
| 90 | Deprecation log severity bumps from `console.warn` to `console.error` in dev mode. | Cut over production agents. |
| 180 | `AGENT_API_KEYS` env var is **ignored**. Legacy bearer requests get 401. | Remove `AGENT_API_KEYS` from your `.env`. |

The 180-day clock starts from **the day this storefront version is deployed to your environment**, not from when this file was committed.

## What does "signed requests" mean?

Each request from an agent now carries two extra HTTP headers:

```
UCP-Agent: openai-chatgpt-prod
UCP-Signature: keyid="agent-key-2026-05",alg="ed25519",sig="<base64-64-bytes>"
```

The storefront:

1. Looks up the agent ID (`openai-chatgpt-prod`) in the **agent registry** — either Payload CMS (when deployed) or the `AGENT_REGISTRY_JSON` env var.
2. Reads the agent's stored `public_key` (raw 32-byte ed25519, base64-encoded).
3. Verifies the `UCP-Signature` against the **raw request body**.
4. Enforces the agent's `scope`, `spending_limit`, and `rate_limit` from the registry.
5. Logs the call to `agent-activity` (Payload) or stdout.
6. If above `APPROVAL_THRESHOLD_CENTS`, creates a pending approval and returns 202 instead of paying.

## 5-step migration

### Step 1 — Get the agent's public key

The agent platform (OpenAI, Google, Anthropic, Microsoft, or your own) generates an ed25519 keypair and shares the **public key** with you. The format is base64 of the raw 32 bytes — same shape as `signing_keys[].public_key` in your `/.well-known/ucp` profile (Phase A1).

If you're running a custom agent and need to generate keys yourself, use the storefront's helper:

```bash
node scripts/generate-signing-keys.mjs
# UCP_SIGNING_PRIVATE_KEY="..."
# UCP_SIGNING_PUBLIC_KEY="..."
# UCP_SIGNING_KEY_ID="..."
```

The agent keeps `UCP_SIGNING_PRIVATE_KEY` secret. You only need `UCP_SIGNING_PUBLIC_KEY`.

### Step 2 — Decide on storage: Payload or env

**Option A — Payload (recommended for production):**

Once your Payload deploy ships (Algaweb Phase 2), copy `payload-collections/Agents.ts` into Payload's `payload.config.ts`, deploy, and add agents through the admin UI. The merchant gets a visual list with suspend/reactivate buttons.

**Option B — Env JSON (works today):**

Add the agents to `.env`:

```env
AGENT_REGISTRY_JSON=[
  {
    "id": "openai-chatgpt-prod",
    "display_name": "ChatGPT (production)",
    "platform": "openai",
    "status": "active",
    "public_key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    "scope": ["catalog.read","cart.create","cart.update","checkout.create","checkout.complete"],
    "spending_limit": { "per_session_cents": 50000, "per_day_cents": null, "per_month_cents": null },
    "rate_limit": { "requests_per_minute": 60, "sessions_per_day": 1000 },
    "contact_email": "abuse@openai.com",
    "created_at": "2026-05-11T00:00:00Z",
    "updated_at": "2026-05-11T00:00:00Z"
  }
]
```

(Single line for env — pretty-printed here only for clarity.)

### Step 3 — Verify the signed flow works

In a staging environment, ask the agent to send a signed request. The storefront responds with a normal 2xx and **does not** emit the `[auth] DEPRECATED` warning that legacy bearer triggers.

Check the activity log:

```bash
# stdout (works without Payload)
docker logs storefront 2>&1 | grep '\[agent-log\]'
```

You should see one entry per request with `agent_id`, `action`, `status`, `duration_ms`.

### Step 4 — Cut over production

Update each agent's deployment to send signed requests instead of bearer tokens. The storefront accepts both during the dual-mode window — there's no flag day, agents migrate independently.

When the last agent is on the new flow, you'll stop seeing `[auth] DEPRECATED` warnings in the storefront logs.

### Step 5 — Remove `AGENT_API_KEYS`

After day 180 the env var is ignored. Removing it earlier (once all agents are on signed requests) is safe — legacy bearer requests will start getting 401 and the agents will know they need to migrate.

## What if I don't migrate?

After day 180:

- Bearer tokens in `Authorization: Bearer <key>` get 401.
- The agent platform sees the storefront refuse traffic and either complains to you or stops sending agents.
- Your audit log loses entries for the failed calls but the deployment is otherwise unaffected.

## Questions

- **Q: Does this affect customer OAuth2 flows?** No. OAuth2 (where a user grants an agent customer-scoped access) is a separate auth path and is unchanged. Phase B7 added an `agent_id` JWT claim that ties the OAuth client to a registered agent — opt-in via `OAUTH_CLIENT_AGENT_MAPPING`, not required.
- **Q: What about the MCP transport?** MCP tools at `/mcp` use the same `verifyAgentRequest` middleware once they're migrated (currently still on the legacy path).
- **Q: Can I keep AGENT_API_KEYS forever?** No — the Day 180 cutover is hard. The legacy code path will be deleted from the storefront codebase.
- **Q: Where do I report bugs in this migration?** GitHub issues on the storefront repo, or email Algaweb directly.
