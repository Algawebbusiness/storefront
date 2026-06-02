# Security Audit & Code Review — Algaweb Agent-Native Storefront

> Date: 2026-06-01 · Repo: Algawebbusiness/storefront (local /home/jiri/code/storefront) · HEAD ff532994
> Method: multi-agent STRIDE fan-out (10 security lenses + 4 quality lenses), each finding adversarially verified by 3 skeptics (survives if ≥2/3 confirm).
> Summary counts: 55 raw security findings → 49 confirmed, 6 dropped as likely false-positive. Severity (confirmed): 27 High · 9 Medium · 7 Low · 6 Info. Plus 32 quality findings.
> READ-ONLY audit — no code was changed.

---

### 1. Executive Summary

The security posture of this storefront is weak at exactly the points that matter most: the agent-protocol and OAuth surfaces that move money and expose customer PII. The architecture is thoughtfully layered (a single `verifyAgentRequest` entry, a `withUcpRoute` guard chain, an OAuth AS with PKCE and timing-safe secret checks), but the actual enforcement is full of holes — most critically, **no resource route ever checks that the caller owns the order/cart/checkout it acts on**. The single most dangerous issue is this pervasive horizontal-authorization failure (IDOR/BOLA): any authenticated agent or customer can read any customer's order (email + addresses), complete or cancel any checkout with their own Stripe token, and refund any order — because resources are fetched by raw Saleor ID through a client that sends no Authorization header and the captured `saleorToken`/`userId` is never used to scope queries. Compounding this, the `/mcp` endpoint is explicitly public yet registers `complete_checkout`/`get_order_full` and treats a missing api_key as "trusted," so money-moving and PII tools are reachable with zero authentication. A third systemic failure: when `AGENT_API_KEYS` is unset (an easy, supported default), the legacy bearer path fails open to a full-scope synthetic agent with a $10,000 cap, and the ACP completion route bypasses scope/limit/approval checks entirely.

Overall code health is mixed: the abstractions are reasonable but undermined by two parallel auth code paths, copy-pasted validation logic, and security-critical state (auth codes, refresh-token revocation, rate/spend buckets) held in per-process memory despite documented multi-instance deploy targets. Tests give false assurance — existing integration tests actively codify the IDOR behavior as correct, and CI never gates types/tests/lint on pull requests.

Top three things to fix first: (1) enforce ownership on every UCP/ACP/MCP resource route and refuse to register payment/PII tools on the public `/mcp` transport; (2) fail closed when `AGENT_API_KEYS` is unset in production and route ACP completion through the same guard chain as UCP; (3) escape JSON-LD output and stop embedding live Saleor access/refresh tokens inside the issued JWTs.

### 2. Project Map

- **Frontend/runtime**: Next.js 16.1.2 (App Router, React 19, PPR/`cacheComponents`), TypeScript, Tailwind v4, next-intl, Zustand. `output: standalone`, Dockerfile; targets Vercel/Cloudflare/Sliplane.
- **Commerce backend**: Saleor GraphQL (single default channel), no own DB; optional Payload CMS (REST) for agent registry/activity/approvals/spend.
- **Agent surfaces**: ACP (OpenAI) and UCP (Google) REST under `src/app/api/{acp,ucp}/...` (~31 routes); an OAuth2 authorization server (`src/app/oauth/*`, `src/lib/oauth/*`); an MCP server (`src/mcp-server`, HTTP transport at `src/app/mcp/route.ts`) with iframe MCP Apps.
- **Auth model** (`src/lib/protocols/shared/auth.ts`): three converging paths — ed25519 signed agent request, OAuth2 HS256 JWT bearer (customer-scoped, embeds `saleor_token`), and legacy `AGENT_API_KEYS`/`ACP_API_KEY` bearer mapping to a full-scope synthetic agent. UCP routes wrap handlers in `withUcpRoute` (flag → auth → scope → amount → limits → activity log); ACP routes mostly call the deprecated `validateAgentApiKey` with no guard chain.
- **Payments**: Stripe shared-payment-token / Link wallet via Saleor `transactionInitialize`/`transactionProcess` (`src/lib/protocols/shared/payment.ts`).
- **Shared Saleor gateway**: `src/mcp-server/saleor-client.ts:saleorQuery` (111 call sites) — sends no Authorization header.
- **Untrusted entry points**: OAuth `authorize`/`consent`/`token`/`userinfo`/`revoke`; all UCP/ACP REST; `/mcp` JSON-RPC; webhooks (Saleor HMAC, revalidate); cron abuse-scan; auth register/reset; OG image; products feed; `.well-known/ucp`.

### 3. Findings (sorted by severity, Critical → Info)

Note on merges: the finder agents reported the IDOR class, the legacy fail-open, the MCP unauth exposure, the in-memory-state issue, the embedded-Saleor-token issue, and the missing-security-headers issue multiple times each. These are merged below into single findings.

---

[HIGH] Horizontal authorization bypass (IDOR/BOLA) across all order/cart/checkout resource routes — read, complete, cancel, and refund any customer's resources (Confidence: High)
Location:

- `src/app/api/ucp/rest/orders/[id]/route.ts:26-49`
- `src/app/api/ucp/rest/carts/[id]/route.ts:39-57`
- `src/app/api/ucp/rest/checkout-sessions/[id]/complete/route.ts:69-181`
- `src/app/api/ucp/rest/orders/[id]/return/route.ts:71-201`
- `src/app/api/acp/orders/[id]/route.ts:27-48`
- `src/app/api/acp/checkout/[id]/complete/route.ts:27-101`
- `src/mcp-server/saleor-client.ts:24-28`
  Category: Broken Object-Level Authorization (CWE-639)
  Evidence:

```js
async (_request, auth, { id }) => {
	const result = (await saleorQuery) < OrderByIdData > (ORDER_BY_ID_QUERY, { id });
	// no check of id against auth.userContext.userId / auth.agent.id
	return signedJsonResponse({ ucp: ucpMeta, order: mapOrderToProtocol(result.data.order) });
};
// saleor-client.ts — NO Authorization header attached:
const res = await fetch(SALEOR_API_URL, {
	method: "POST",
	headers: { "Content-Type": "application/json" },
	body: JSON.stringify({ query, variables }),
});
```

Impact: Likelihood High × Impact High. Any authenticated agent/customer (or anonymous when `AGENT_API_KEYS` is unset) supplies an arbitrary Saleor order/checkout/cart ID and reads another customer's PII (email, shipping/billing address, phone, line items), completes/charges someone else's checkout with the attacker's own Stripe token, cancels it, or triggers a full original-payment refund on any order. Authorization collapses to "knows the opaque ID."
Reproduction / reasoning: `verifyAgentRequest` populates `auth.userContext.{userId,email,saleorToken}`, but no handler compares the fetched resource's owner (`order.user.id`/`order.userEmail`/`checkout.user`) to it. `saleorQuery` sends no Authorization header, so Saleor answers at app/anonymous trust level for any opaque ID. The return route enforces only the _presence_ of `userContext`, never ownership, and for full-order `original_payment` returns it immediately calls `triggerSaleorRefund` with the privileged `MANAGE_ORDERS` token. IDs leak via prior responses, webhooks, emails, and the approval-status route below; checkouts created in the same agent flow are directly known.
Remediation: For OAuth-scoped calls, perform the Saleor query authenticated as the customer (`Authorization: Bearer <userContext.saleorToken>`) so Saleor enforces ownership natively, and/or assert `order.userEmail === auth.userContext.email` (404 on mismatch) before returning or refunding. For agent-signed (no user context) routes, bind `agent_id` into checkout metadata at create time and reject reads/completes of unbound resources. Add `Authorization` as an explicit parameter to `saleorQuery`.
References: CWE-639, CWE-285

---

[HIGH] MCP `/mcp` transport is unauthenticated yet registers payment and PII tools; `validateApiKey(undefined)` returns true (Confidence: High)
Location:

- `src/app/mcp/route.ts:14-44`
- `src/mcp-server/tools/checkout.ts:53-64,341-370`
- `src/mcp-server/tools/order-receipt.ts:26-40,94-116`
- `src/mcp-server/index.ts:46`
  Category: Missing Authentication / Function-Level Authorization (CWE-306, CWE-862)
  Evidence:

```js
function validateApiKey(apiKey: string | undefined): boolean {
  if (apiKey === undefined) return true;   // "trust the transport"
  ...
  if (validKeys.size === 0) return true;
  return validKeys.has(apiKey);
}
// route.ts: "This is a public, read-only endpoint. No authentication required."
// index.ts: registerCheckoutTools(server);
```

Impact: Likelihood High × Impact High. The endpoint has zero transport auth yet `registerCheckoutTools` registers `complete_checkout`/`create_checkout`/`update_checkout` and `get_order_full`/`get_cart_full`. An unauthenticated JSON-RPC `tools/call` (omitting `api_key`) exfiltrates buyer email + shipping/billing addresses or drives a Stripe charge + checkout completion against any `checkout_id`. No scope, spend cap, rate limit, or ownership binding applies. The "read-only" claim is false.
Reproduction / reasoning: The "trust the transport" branch is only valid when an upstream layer authenticated the caller; here the transport is the public HTTP route itself. `visibility:["app"]` only hides tools from `tools/list` — the SDK still dispatches `tools/call` by name. With `AGENT_API_KEYS` unset, the empty-keys branch also returns true.
Remediation: Do not register payment/PII/mutating tools on the public transport — split into a public read-only MCP server and an authenticated checkout server, or gate `/mcp` with the same `verifyAgentRequest` auth as UCP. Make `validateApiKey` fail closed: `undefined` ⇒ false unless a verified transport-level identity is proven. Apply scope/limit/approval/ownership equivalent to `withUcpRoute` to money-moving tools.
References: CWE-306, CWE-862

---

[HIGH] Dev/legacy bearer fallback grants full-scope, high-cap access when `AGENT_API_KEYS` is unset; ACP complete route has no guard chain (Confidence: High)
Location:

- `src/lib/protocols/shared/auth.ts:33-51,146-148,291-294`
- `src/app/api/acp/checkout/[id]/complete/route.ts:35-81`
  Category: Broken Authentication / Insecure Default / Spending-Limit Bypass (CWE-1188, CWE-862)
  Evidence:

```js
if (validKeys.size === 0) {
	// Dev mode: no keys configured, accept anyone (preserves legacy behaviour).
	return acceptLegacy(request, bodyText, "anonymous");
}
// SYNTHETIC_LEGACY_AGENT: full scope + per_session_cents: 10_000_00
// ACP route:
const auth = validateAgentApiKey(request);
if (!auth.valid) return unauthorizedResponse();
const paymentResult = await processStripePayment(id, body.payment_token);
// no hasScope, no checkLimits, no requiresApproval
```

Impact: Likelihood Medium × Impact High. Deploying without `AGENT_API_KEYS`/`ACP_API_KEY` (optional, no startup enforcement) makes every UCP/ACP legacy-bearer request — or no bearer at all — accepted as `SYNTHETIC_LEGACY_AGENT` with full scope (`catalog`/`cart`/`checkout.complete`/`order.read`) and a $10,000/session cap. The ACP completion route additionally skips scope, spend caps, and the `APPROVAL_THRESHOLD_CENTS` high-value gate entirely, so any caller can complete/charge high-value checkouts. Combined with the IDOR finding, this yields unauthenticated cross-customer reads and arbitrary checkout completion.
Reproduction / reasoning: `verifyLegacyBearer`/`validateAgentApiKey` return `acceptLegacy('anonymous')` / `{valid:true}` when no keys are set; `acceptLegacy` stamps the all-scope synthetic agent. The ACP route never enters `withUcpRoute`, so none of the B5/B6 controls run. The only residual guard is the per-process in-memory session cap.
Remediation: Fail closed — when `AGENT_API_KEYS` and the signing registry are both unconfigured, reject (401) unless an explicit `NODE_ENV !== 'production'` dev flag is set. Give the synthetic anonymous identity empty scope and zero cap. Migrate ACP completion onto a shared guarded wrapper (`verifyAgentRequest` + `hasScope('checkout.complete')` + `computeAmountCents`/`checkLimits` + `requiresApproval`).
References: CWE-1188, CWE-862, CWE-285

---

[HIGH] ed25519 signed-request scheme has no canonicalization (method/URL/path-id) and no anti-replay; bodiless GETs sign the empty string (Confidence: High)
Location: `src/lib/protocols/shared/auth.ts:215-219,318-324`; `src/lib/protocols/shared/signing.ts:67-78`
Category: Broken signature scheme — replay & insufficient canonicalization (CWE-347)
Evidence:

```js
async function safeReadBody(request: Request): Promise<string> {
  try { return await request.text(); } catch { return ""; }   // fail-open
}
const bodyText = await safeReadBody(request);
const valid = await verifyDetached(bodyText, parsed.sig, lookup.agent.public_key);
if (!valid) return { ok: false, status: 401, reason: "Invalid signature" };
```

Impact: Likelihood High × Impact High. Only the raw body is signed — not the HTTP method, full URL, path param `id`, query string, or any timestamp/nonce. Every bodiless request (GET/DELETE) reduces to verifying a signature over `""`, so a single captured signature-over-empty-string is a universal, infinitely replayable read credential for that agent across all bodiless UCP endpoints and all resource IDs. The auth layer also fails open (treats a body-read error as empty-string success rather than 401).
Reproduction / reasoning: `verifySignedRequest` passes only `bodyText` to `verifyDetached`; no nonce/timestamp/replay check exists anywhere in `auth.ts`/`signing.ts`. An attacker observing one signed GET (proxy, logs, TLS-terminating gateway, agent platform) replays it and pivots to arbitrary IDs — directly amplifying the IDOR finding above.
Remediation: Sign over a canonical string of method + path + query + `UCP-Timestamp` + `UCP-Nonce` (+ body hash for writes), per RFC 9421. On verify: reject timestamps outside a small skew window, reject reused nonces (persistent store), require the path `id` to be covered. Treat a body-read failure as a hard 401.
References: CWE-347

---

[HIGH] Stored SSRF via agent-controlled `webhook_url` (no URL validation before server-side fetch) (Confidence: High)
Location: `src/app/api/ucp/rest/orders/[id]/return/route.ts:167`; `src/lib/protocols/shared/return-mapper.ts:253`; `src/lib/protocols/shared/agent-webhooks.ts:79`
Category: SSRF (CWE-918)
Evidence:

```js
// return/route.ts
...(body.webhook_url ? { webhook_url: body.webhook_url } : {}),
// agent-webhooks.ts
const res = await fetch(webhook_url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "UCP-Signature": sigHeader },
  body, signal: AbortSignal.timeout(10_000),
});
```

Impact: Likelihood Medium × Impact High. An authenticated agent (or full-scope dev bearer) registers an internal `webhook_url` on a return; on `ORDER_REFUNDED` the server POSTs a signed body to it with retries, reaching cloud metadata (`169.254.169.254`), localhost admin ports, or internal services. Delivery is triggered from the Saleor `ORDER_REFUNDED` handler, which is itself forgeable when the webhook secret is unset (see below).
Reproduction / reasoning: `body.webhook_url` is taken verbatim, persisted by `createReturnRecord`, then fetched in `notifyAgent`. No `new URL`, scheme check, allowlist, or private-IP/loopback/metadata filtering exists. Node `fetch` follows redirects by default, so any future host check is also redirect-bypassable.
Remediation: Parse with `new URL()`, require `https`, reject private/loopback/link-local resolved IPs (`127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`, `fc00::/7`) after DNS resolution, restrict to per-agent pre-registered callback domains, set `redirect:'manual'` and re-validate. Consider an egress proxy/allowlist.
References: CWE-918

---

[HIGH] Saleor webhook signature verification fully skipped when `SALEOR_WEBHOOK_SECRET` is unset (fail-open) (Confidence: High)
Location: `src/app/api/webhooks/saleor/route.ts:168-177,246-277`
Category: Missing webhook authentication (CWE-345)
Evidence:

```js
if (WEBHOOK_SECRET) {
	const signature = request.headers.get("Saleor-Signature");
	if (!signature || !verifyWebhookSignature(rawBody, signature, WEBHOOK_SECRET)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
}
// no else: if WEBHOOK_SECRET unset, ALL events accepted unsigned
```

Impact: Likelihood Medium × Impact High. When the secret is not configured (a supported state), any unauthenticated POST forges `ORDER_REFUNDED` (driving return state changes + `notifyAgent`, chaining the SSRF above) or `ORDER_CREATED` (driving `MANAGE_ORDERS` admin GraphQL fetches/metadata writes via `propagateIntentToOrder` using the privileged `SALEOR_APP_TOKEN`).
Reproduction / reasoning: The signature block only runs when `WEBHOOK_SECRET` is truthy; there is no fail-closed `else`. The route is internet-reachable and mutates state from an attacker-controlled body.
Remediation: Fail closed — if `SALEOR_WEBHOOK_SECRET` (or the JWS public-key path) is unset, reject. Never process unsigned mutating webhooks.
References: CWE-345

---

[HIGH] Next.js image optimizer accepts any remote host (`remotePatterns: { hostname: "*" }`) in production — open image proxy / SSRF (Confidence: High)
Location: `next.config.js:19-34`
Category: Security misconfiguration / SSRF (CWE-918)
Evidence:

```js
images: {
  remotePatterns: [
    { hostname: "*.saleor.cloud" },
    { hostname: "*.media.saleor.cloud" },
    { hostname: "*" },   // "Allow all hostnames in development (restrict in production)"
  ],
},
```

Impact: Likelihood High × Impact High. The `"*"` entry is unconditional (no `NODE_ENV` gate), so in production `/_next/image?url=<arbitrary>` makes the server fetch and re-serve arbitrary URLs — reaching internal/metadata endpoints, masking outbound requests, and amplifying traffic. Unauthenticated.
Reproduction / reasoning: Next's optimizer fetches any `url` whose host matches a `remotePattern`; `"*"` matches every host, turning the optimizer into an open proxy.
Remediation: Remove the `{ hostname: "*" }` entry; pin exact Saleor/CDN origins with `protocol: "https"`. If a dev escape hatch is needed: `...(process.env.NODE_ENV === 'development' ? [{ hostname: '*' }] : [])`.
References: CWE-918

---

[HIGH] Stored XSS via unescaped JSON-LD injected with `dangerouslySetInnerHTML` (JSON.stringify does not escape `</script>`) (Confidence: High)
Location: `src/lib/seo/json-ld.ts:35-139,242`; `src/app/[channel]/(main)/products/[slug]/page.tsx:170-180`; `categories/[slug]/page.tsx:98`; `collections/[slug]/page.tsx:98`; `blog/[slug]/page.tsx:66`; `(main)/page.tsx:58,64`
Category: Cross-site scripting / output encoding (CWE-79)
Evidence:

```jsx
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }} />
// json-ld.ts embeds product.name, product.seoDescription, category.name (brand) raw
```

Impact: Likelihood Medium × Impact High. Anyone able to set a product/category/collection name or SEO description (merchant admin, or a less-trusted seller/content editor in the multi-tenant model) can inject `</script><img src=x onerror=...>` that executes in every visitor's browser on the PDP/PLP/home/blog pages — session/credential theft, account takeover, cart manipulation.
Reproduction / reasoning: `buildProductJsonLd`/`buildBreadcrumbListJsonLd` copy attacker-influenceable strings verbatim into the object; the pages serialize it with `JSON.stringify` into a `<script>`. `JSON.stringify` does not escape `<`/`>`/`/`, so the literal `</script>` substring terminates the script element. The repo already has the correct defense at `src/mcp-server/apps/serve-html.ts:56` (`.replace(/</g,"\\u003c")`) — it is simply not applied here.
Remediation: Escape before injecting: `JSON.stringify(data).replace(/</g,"\\u003c").replace(/>/g,"\\u003e").replace(/&/g,"\\u0026")` (and U+2028/U+2029). Centralize in a single `JsonLdScript` helper (`json-ld.ts:238/242`) used by every call site so none can forget. Under a strict CSP `script-src`, use a nonce.
References: CWE-79

---

[HIGH] OAuth JWTs embed live Saleor access AND refresh tokens as plaintext claims (HS256, base64-readable) (Confidence: High)
Location: `src/lib/oauth/tokens.ts:48-52,55-71,125-141`; `src/app/oauth/token/route.ts:106-127`; `src/lib/protocols/shared/auth.ts:269-275`
Category: Sensitive data exposure / token confidentiality (CWE-522)
Evidence:

```js
saleor_token?: string; // "Saleor access token (only in server memory, not exposed)"
saleor_refresh_token?: string;
const access_token  = signJwt({ ...basePayload, type: "access",  saleor_token: params.saleorToken }, ACCESS_TOKEN_TTL);
const refresh_token = signJwt({ ...basePayload, type: "refresh", saleor_refresh_token: params.saleorRefreshToken }, REFRESH_TOKEN_TTL);
```

Impact: Likelihood Medium × Impact High. The comment claims the token is "not exposed," but `signJwt` only HMAC-signs and base64url-encodes the payload — anyone holding the JWT (logs, Referer, agent-platform storage, proxy) decodes it and obtains the customer's live Saleor access+refresh tokens, bypassing this app entirely. The refresh JWT (default 30-day TTL) carries `saleor_refresh_token`, so one leak yields a month of Saleor access. Ironically the embedded `saleor_token` is largely unused downstream (`saleorQuery` sends no Authorization header), so it is carried at high risk for little benefit.
Reproduction / reasoning: JWT bodies are signed, not encrypted; the access token is returned to the third-party agent platform by design, multiplying leak surface.
Remediation: Do not embed Saleor tokens in client-visible JWTs. Store them server-side keyed by `jti`/`sub` (Redis/DB) and look up at use time, or encrypt (JWE with a separate key) if they must travel. At minimum, drop `saleor_token` from the access token and keep `saleor_refresh_token` out of the long-lived refresh JWT.
References: CWE-522

---

[HIGH] Return/refund double-payout: dedup state is in-memory only and the check-then-act is non-atomic (Confidence: High)
Location: `src/lib/protocols/shared/return-mapper.ts:142-148,269-271`; `src/app/api/ucp/rest/orders/[id]/return/route.ts:150`
Category: Race condition / TOCTOU — refund abuse (CWE-367)
Evidence:

```js
if (existingReturns.some((r) => r.status === "refunded" || r.status === "approved")) {
  return { ok:false, code:"already_returned" };
}
export function listReturnsForOrder(orderId: string): OrderReturn[] {
  return Array.from(returnsStore.values()).filter((r) => r.order_id === orderId);
}
```

Impact: Likelihood Medium × Impact High. The only guard against repeat refunds reads a module-level in-memory Map. On multi-instance deploys (the documented target) or after restart, `listReturnsForOrder` returns empty, so the same paid order is refundable again; two concurrent requests also race the check. Combined with the missing ownership check, the blast radius is direct double-payout.
Reproduction / reasoning: There is no Saleor-side check of existing refunds and no locking; `createReturnRecord` is non-atomic.
Remediation: Track refund state in Saleor (query `order.totalCaptured`/refunds, or fulfillment-return status), make create-return atomic (unique constraint in Payload, or check Saleor refunds before triggering), and add idempotency keys.
References: CWE-367

---

[HIGH] Checkout completion is not idempotent or atomic — concurrent/retried POSTs double-charge and bypass the session cap (Confidence: High)
Location: `src/app/api/ucp/rest/checkout-sessions/[id]/complete/route.ts:69-151`; `src/lib/protocols/shared/limits.ts:45-96`; `src/lib/protocols/shared/route-handler.ts:135-141`
Category: Concurrency / idempotency on a money-moving path (CWE-367)
Evidence:

```js
computeAmountCents: async (_auth, { id }) => fetchCheckoutTotalCents(id),
// no lock between fetch and complete
const paymentResult = await processStripePayment(id, body.payment.token, paymentMethod);
const completeResult = await saleorQuery(CHECKOUT_COMPLETE_MUTATION, { checkoutId: id });
```

Impact: Likelihood Medium × Impact High. Two concurrent POSTs to the same checkout (or an agent retry on timeout) both pass `checkLimits` (which only increments an in-memory counter, not a per-checkout idempotency record) and both reach `processStripePayment` → `checkoutComplete` — duplicate charge / spend-cap bypass.
Reproduction / reasoning: `checkLimits` is a synchronous increment but runs after an awaited `computeAmountCents` Saleor fetch; there is no checkout-level lock or idempotency key.
Remediation: Require an `Idempotency-Key` (agent-supplied or derived from checkout id) recorded in durable storage before charging; short-circuit duplicate completes. Reuse the already-fetched checkout instead of re-fetching.
References: CWE-367

---

[MEDIUM] Security-critical state (auth codes, revoked refresh JTIs, rate/spend buckets) is in per-process memory — replay & cap bypass across restart/instances (Confidence: High)
Location: `src/lib/oauth/codes.ts:34`; `src/lib/oauth/tokens.ts:155-166`; `src/lib/protocols/shared/limits.ts:33-36`; `src/app/api/revalidate/route.ts:35`
Category: Token lifecycle / replay / limit integrity (CWE-613, CWE-837)
Evidence:

```js
const codeStore = new Map<string, StoredAuthorizationCode>();
const revokedTokens = new Set<string>();
const requestBuckets = new Map<string, BucketEntry>();
const sessionBuckets = new Map<string, Set<string>>();
```

Impact: Likelihood Medium × Impact Medium. The template targets Vercel/Cloudflare/Sliplane (serverless, multi-instance, cold starts). Per-process Maps/Sets mean: a revoked/rotated refresh token replayed against another instance is accepted; an auth code is single-use only within one instance; RPM/session/spend caps reset on cold start and multiply across instances (`per_session_cents` also only caps a single request, not cumulative spend). Day/month caps silently see zero prior spend when `PAYLOAD_API_URL` is unset.
Reproduction / reasoning: All stores are module-level; the rotation-reuse and code single-use checks consult only local memory. The code comments themselves note Redis is required.
Remediation: Back auth codes, the revoked-JTI set, and rate/spend counters with Redis/DB (TTLs); fail closed when the store is unavailable for security checks. Make `per_session_cents` cumulative. Until then, document and enforce a single-instance constraint.
References: CWE-613, CWE-837

---

[MEDIUM] No security response headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) (Confidence: High)
Location: `next.config.js:55-98`; `src/middleware.ts:1-31`
Category: Missing hardening / defense-in-depth (CWE-693)
Evidence:

```js
async headers() {
  // only Cache-Control entries; no CSP / X-Frame-Options /
  // X-Content-Type-Options / Strict-Transport-Security / Referrer-Policy
}
// middleware.ts only sets NEXT_LOCALE cookie; matcher excludes /api
```

Impact: Likelihood Medium × Impact Medium. Absence of CSP removes the containment that would blunt the JSON-LD XSS (an injected script still runs unrestricted). No `X-Frame-Options`/`frame-ancestors` allows clickjacking of the `/oauth/*` consent/login (email+password) form; no `X-Content-Type-Options` permits MIME sniffing; no HSTS weakens transport. The `csp.ts` MCP-Apps object is an advisory `_meta.ui.csp` handed to the MCP host, not an HTTP header on this origin.
Reproduction / reasoning: `rg` across `src`/`next.config.js` for these headers returns no matches; `headers()` emits only Cache-Control.
Remediation: Add a `headers()` block for `source:'/(.*)'` with at minimum a baseline CSP (`default-src 'self'`; `script-src 'self'` + nonce for JSON-LD; `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and HSTS in production. Apply `frame-ancestors 'none'` specifically to `/oauth/*`.
References: CWE-693

---

[MEDIUM] No rate limiting / brute-force protection on OAuth login, token, and password-reset endpoints (Confidence: High)
Location: `src/app/oauth/consent/route.ts:23-85`; `src/app/oauth/token/route.ts:43-79`; `src/app/api/auth/reset-password/route.ts:28-62`
Category: Missing brute-force protection (CWE-307)
Evidence:

```js
const loginResult = await saleorLogin(email, password); // no rate limit, no lockout
// token route: verifyClientSecret then grant — no limit on client_secret/code attempts
// reset-password: unlimited requestPasswordReset (email-send amplification)
```

Impact: Likelihood Medium × Impact Medium. `/oauth/consent` proxies unlimited credential attempts to Saleor (credential stuffing / password spraying), `/oauth/token` allows unlimited `client_secret`/code guessing per client, and reset-password allows unlimited reset-email triggering. Only `/api/revalidate` has any limiter.
Remediation: Add per-IP and per-account rate limiting + exponential backoff/lockout on consent login and token grant failures; throttle reset-password by IP/email. Use a shared store given multi-instance deploys.
References: CWE-307

---

[MEDIUM] Spending-cap enforcement is bypassable: TOCTOU on cart total and fail-open day/month caps without Payload (Confidence: Med)
Location: `src/app/api/ucp/rest/checkout-sessions/[id]/complete/route.ts:63-74,119-140`; `src/lib/protocols/shared/limits.ts:75-92,188-205`
Category: Spending-cap bypass / fail-open control (CWE-367)
Evidence:

```js
computeAmountCents: async (_auth, { id }) => fetchCheckoutTotalCents(id), // check
const totalCents = Math.round(fetchResult.data.checkout.totalPrice.gross.amount*100); // re-fetched
await processStripePayment(id, ...); // charge uses Saleor's then-current total
// limits.ts: if (!process.env.PAYLOAD_API_URL) return { spent_today_cents:0, spent_this_month_cents:0 };
```

Impact: Likelihood Low-Medium × Impact Medium. The cap is checked against an agent-controllable cart total that can be mutated (add lines) between the check and the charge. Without Payload configured, per-day/per-month aggregates always read 0, so cumulative caps never trip; even with Payload the counter is post-hoc (activity log) so concurrent completions race.
Remediation: Enforce caps against the exact total used to charge (pass the verified amount through to payment; reject if changed). Treat absence of a persistent spend store as fail-closed for configured day/month caps rather than returning zeros. Use atomic reserve/commit counters.
References: CWE-367

---

[MEDIUM] OAuth bearer without a registry-mapped `agent_id` defaults to the full-scope synthetic agent; consented scope never enforced (Confidence: Med)
Location: `src/lib/protocols/shared/auth.ts:250-261`
Category: Privilege escalation / scope enforcement (CWE-269)
Evidence:

```js
let agent: AgentIdentity = { ...SYNTHETIC_LEGACY_AGENT, id: payload.client_id ?? "oauth-bearer" };
let isLegacy = true;
if (payload.agent_id) {
  const lookup = await lookupAgent(payload.agent_id);
  if (lookup.found) { agent = lookup.agent; isLegacy = false; }
}
```

Impact: Likelihood Medium × Impact Medium. A customer-scoped OAuth token whose client has no registry mapping is granted the full synthetic scope set rather than what the user consented to. `hasScope` checks `agent.scope`, not `payload.scope`, so a token issued for, e.g., `catalog.read` still passes the `checkout.complete` gate.
Remediation: Derive effective scope from the intersection of consented `payload.scope` and any mapped agent scope, and have `hasScope` honor it. Do not default unmapped OAuth clients to full scope.
References: CWE-269

---

[LOW] Approval-status polling has no ownership binding — any agent can read any approval record (Confidence: High)
Location: `src/app/api/ucp/rest/approvals/[id]/route.ts` (GET handler)
Category: Broken Object-Level Authorization (CWE-639)
Evidence:

```js
const auth = validateAgentApiKey(request);
if (!auth.valid) {
	return signedUnauthorized();
}
const { id } = await params;
const approval = await getApprovalStatus(id);
// returns { id, status, action, resource_id, amount_cents, expires_at }
```

Impact: Likelihood Low × Impact Low. An authenticated agent polls any approval ID and learns another agent's pending action, `resource_id` (checkout/order ID), and `amount_cents` — feeding the resource-ID enumeration needed for the IDOR findings.
Remediation: Verify `approval.agent_id === auth.agent.id` (or resource owner for OAuth) before returning; else 404.
References: CWE-639

---

[LOW] Refresh grant never re-authenticates Saleor; re-issues stale embedded Saleor tokens (Confidence: High)
Location: `src/app/oauth/token/route.ts:160-173`
Category: Session management / missing token rotation (CWE-613)
Evidence:

```js
// Re-use the Saleor refresh token to get new Saleor tokens
// For simplicity, we create new OAuth tokens with the same Saleor tokens
const tokens = createTokenPair({ ... saleorToken: payload.saleor_token || "", saleorRefreshToken: payload.saleor_refresh_token || "" });
```

Impact: Likelihood Medium × Impact Medium. Each refresh re-stamps the original (possibly expired/revoked) Saleor token into a fresh access JWT for up to 30 days. The OAuth session cannot be invalidated by Saleor-side logout/password change; combined with the embed-token finding this extends the window for a leaked Saleor credential, and routes consuming `saleor_token` eventually fail.
Remediation: On refresh, call Saleor `tokenRefresh` with `saleor_refresh_token`, fail the grant if Saleor rejects it, and store the rotated Saleor tokens.
References: CWE-613

---

[LOW] All OAuth clients are statically granted every scope; requested scope is never constrained to a per-client allow-list (Confidence: High)
Location: `src/lib/oauth/config.ts:53-59`; `src/app/oauth/consent/route.ts:53-101`; `src/app/oauth/token/route.ts:103-114`
Category: Authorization / scope enforcement (CWE-863)
Evidence:

```js
clients.set(clientId, { ... allowed_scopes: [...VALID_SCOPES] });
// consent: only validateScopes(scope) format check, no per-client allow-list
// token: scope: stored.scope passed straight through
```

Impact: Likelihood Low × Impact Low. Every registered client is assigned the full scope set, and neither authorize/consent nor token narrows requested scope to a client-specific list. No privilege boundary exists between clients. (The `allowed_scopes` field is written but never read — see Quality.)
Remediation: Make `allowed_scopes` per-client configurable in `OAUTH_CLIENTS`, intersect requested scope at `/oauth/authorize`, and persist the granted (intersected) scope in the auth code.
References: CWE-863

---

[LOW] OG image endpoint renders unbounded attacker-controlled text (CPU/memory DoS) (Confidence: Med)
Location: `src/app/api/og/route.tsx:16-130`
Category: DoS / unbounded input (CWE-400)
Evidence:

```js
const title = searchParams.get("title") || "Saleor Store";
const subtitle = searchParams.get("subtitle") || "";
const price = searchParams.get("price") || "";
return new ImageResponse(
	(
		<div>
			...{title}...{subtitle}...{price}...
		</div>
	),
	{ width: 1200, height: 630 },
);
```

Impact: Likelihood Low-Medium × Impact Low-Medium. The public unauthenticated endpoint passes unbounded query params to satori/`ImageResponse`; very long inputs force expensive layout/rasterization — cheap DoS amplification.
Remediation: Cap each param length (e.g. title ≤120, subtitle ≤160) and truncate before rendering; cache and rate-limit `/api/og`.
References: CWE-400

---

[LOW] saleor-client returns raw upstream fetch error message to callers (Confidence: Med)
Location: `src/mcp-server/saleor-client.ts:46`
Category: Information disclosure / verbose errors (CWE-209)
Evidence:

```js
return { ok: false, error: `Failed to fetch: ${err instanceof Error ? err.message : String(err)}` };
```

Impact: Likelihood Low × Impact Low. Network/DNS error strings (internal hostnames, refused targets, ports) can be reflected to UCP/ACP/MCP callers, leaking deployment topology on upstream failure.
Remediation: Return a generic message to callers; log details server-side only.
References: CWE-209

---

[LOW] Floating (`^`) version ranges on security-sensitive runtime packages despite save-exact policy (Confidence: High)
Location: `package.json:41-54,69-85`
Category: Supply chain / dependency pinning (CWE-1357)
Evidence:

```json
"@modelcontextprotocol/sdk": "^1.29.0",
"next-intl": "^4.8.3",
"react": "^19.1.2",
"zod": "^4.3.0",
"vite": "^7.0.0",
```

Impact: Likelihood Low × Impact Low. Caret ranges permit auto-upgrade to a hijacked minor of the MCP SDK (which backs the public `/mcp` route) on lockfile regeneration. Mitigated day-to-day by `pnpm-lock.yaml` integrity hashes + 24h `minimumReleaseAge`.
Remediation: Pin to exact versions to match `.npmrc save-exact=true`; keep `--frozen-lockfile` everywhere.
References: CWE-1357

---

[LOW] CI lint workflow installs dependencies without `--frozen-lockfile` (Confidence: High)
Location: `.github/workflows/lint.yml:23-24`
Category: Supply chain / CI integrity (CWE-829)
Evidence:

```yaml
- name: Install dependencies
  run: pnpm install
- name: Run lint
  run: pnpm run lint
```

Impact: Likelihood Low × Impact Low. A non-frozen install can resolve newer in-range versions than the committed lockfile, defeating pinning for that job; combined with the caret ranges, a malicious minor published >24h prior could be resolved. Blast radius limited to the lint runner.
Remediation: Use `pnpm install --frozen-lockfile`, matching the Dockerfile and `update_types.yml`.
References: CWE-829

---

[INFO] Revalidate webhook falls back to a non-constant-time static header secret (Confidence: Med)
Location: `src/app/api/revalidate/route.ts:182-189`
Category: Webhook auth / timing (CWE-208)
Evidence:

```js
if (!verifyWebhookSignature(rawBody, signature)) {
	const staticSecret = request.headers.get("x-revalidate-secret");
	if (staticSecret !== process.env.REVALIDATE_SECRET || !process.env.REVALIDATE_SECRET) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
}
```

Impact: Likelihood Low × Impact Low. Fail-closed when unset, but the `!==` compare is non-constant-time on a long-lived static bearer. Worst case is cache-invalidation churn. The per-IP limiter keys on spoofable `x-forwarded-for`.
Remediation: Prefer HMAC/JWS; if keeping a static secret, compare with `timingSafeEqual` and require it set.
References: CWE-208

---

[INFO] Cron abuse-scan secret compared with non-constant-time equality (Confidence: High)
Location: `src/app/api/cron/abuse-scan/route.ts:90-95`
Category: Auth on state-change / timing (CWE-208)
Evidence:

```js
return header.slice(7).trim() === CRON_SECRET;
```

Impact: Likelihood Low × Impact Low. Network timing side-channel on a bearer secret is impractical; fail-closed when unset is correct. Noted for completeness.
Remediation: Use `crypto.timingSafeEqual` over equal-length buffers.
References: CWE-208

---

[INFO] Cart line quantity accepts non-integer and unbounded values (Confidence: High)
Location: `src/app/api/ucp/rest/carts/[id]/lines/route.ts:48-58`; `lines/[lineId]/route.ts:48-58`
Category: Input validation / DoS (CWE-20)
Evidence:

```js
if (!body.variant_id || typeof body.quantity !== "number" || body.quantity < 1) { ...400 }
// accepts quantity = 1e9, 1.5, Infinity
```

Impact: Likelihood Low × Impact Low. Inconsistent with the integer-clamped catalog limit and zod-validated MCP tool; relies on Saleor to reject floats/huge values. Defense-in-depth gap.
Remediation: Validate with `Number.isInteger` and a sane max (e.g. ≤10000) in both lines routes.
References: CWE-20

---

[INFO] Non-production fallback silently generates an ephemeral ed25519 signing key; no rotation overlap (Confidence: Med)
Location: `src/lib/protocols/shared/signing.ts:115-134`
Category: Key management (CWE-320)
Evidence:

```js
if (process.env.NODE_ENV === "production") { throw new Error(...); }
console.warn("[ucp/signing] ... generating ephemeral ed25519 keypair ...");
const pair = await subtle().generateKey({ name: "Ed25519" }, true, ["sign","verify"]);
```

Impact: Likelihood Low × Impact Low. Production correctly throws (no confidentiality break). In staging/preview (`NODE_ENV !== 'production'`) responses are signed with a per-process key that changes on restart and differs across instances, so agents cannot verify and the published `/.well-known/ucp` key drifts. No two-key rotation overlap is supported.
Remediation: Gate the ephemeral fallback behind an explicit `UCP_ALLOW_EPHEMERAL_SIGNING` opt-in; support publishing multiple `kid`-keyed public keys for rotation overlap.
References: CWE-320

---

[INFO] `NEXT_LOCALE` cookie set without `Secure` flag (Confidence: High)
Location: `src/middleware.ts:16-21`
Category: Cookie hardening (CWE-614)
Evidence:

```js
response.cookies.set("NEXT_LOCALE", locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
```

Impact: Likelihood Low × Impact Low. Non-sensitive locale cookie, but the missing `secure` reflects a default-insecure pattern that future auth cookies could inherit.
Remediation: Add `secure: process.env.NODE_ENV === 'production'`; establish a secure+httpOnly+sameSite convention.
References: CWE-614

---

[INFO] `X-Powered-By` header not disabled (Next.js version disclosure) (Confidence: High)
Location: `next.config.js:6-106`
Category: Information disclosure / hardening (CWE-200)
Evidence:

```js
const config = { cacheComponents: true, ... }; // no poweredByHeader: false
```

Impact: Likelihood Low × Impact Low. Default `X-Powered-By: Next.js` aids fingerprinting.
Remediation: Set `poweredByHeader: false`.
References: CWE-200

### 4. Quality Assessment

**Architecture.** The strongest part of the codebase is the central `withUcpRoute` wrapper (`route-handler.ts`) — a genuinely good abstraction that funnels feature-flag, auth, scope, amount, limit, and activity-logging concerns into one place. Its value is undermined by the single worst architectural defect: two parallel auth code paths with divergent semantics (`auth.ts:93-162`). `verifyAgentRequest` is scope/limit-aware; the `@deprecated validateAgentApiKey` is not, yet all five ACP routes plus `ucp/rest/approvals/[id]` call the deprecated path directly, silently bypassing the entire guard chain for a whole protocol surface (High). The B9 migration must be finished and `validateAgentApiKey`/`validateOAuthToken` deleted. A second leaky abstraction: the de-facto shared GraphQL gateway `saleorQuery` is named and located under `mcp-server/` despite 111 call sites across UCP/ACP, carries a stale comment, and silently drops `userContext.saleorToken` — the very design choice that produces the IDOR class (`saleor-client.ts:1-48`, Medium). It should move to `src/lib/protocols/shared/`, fix its comment, and take an explicit `Authorization` parameter.

**Maintainability.** Duplication is pervasive in the security-sensitive layer: `validateApiKey`/`validateOptionalApiKey` is copy-pasted across four MCP tool files plus a fifth copy in `auth.ts`, with two divergent return conventions (Medium) — so closing the `undefined`-bypass hole requires edits in five places. The ACP PATCH checkout handler repeats a five-line apply/check/map block six times (plus a seventh divergent copy in the MCP `update_checkout` tool), and inconsistencies have already crept in (`remove_promo_code` ignores errors while siblings 400) (Medium). `OAuthClient.allowed_scopes` is declared, always populated with all scopes, and never read — a dead field that misrepresents a non-existent per-client scope capability and would silently grant everything to a future dev who wired consent against it (Medium). UCP resource routes repeat the same fetch/500/404/meta-wrap scaffold 6+ times with drifting error strings (Low). Type-safety config is loose (`allowUnreachableCode: true`, `noUncheckedIndexedAccess: false`) on a codebase doing index access on token-derived data (Low); notably `as any` count is 0 in `src` (the few unsafe casts live under excluded `src/_reference/**`).

**Correctness.** Beyond the security-graded concurrency findings, several correctness defects stand out: `verifyJwt` decodes the signature with standard base64 instead of base64url (`tokens.ts:74-104`), so legitimate tokens whose signature bytes encode to `-`/`_` are wrongly rejected — an intermittent auth-availability bug (Medium; not a bypass since HMAC is recomputed, but `alg` is never asserted either). The refresh grant reuses stale embedded Saleor tokens (Medium, also graded as security). `complete_checkout`'s fallback fabricates `isPaid:false, total:0, currency:""` after a _successful_ order creation, so a downstream agent renders a paid order as unpaid (`checkout.ts:464-487`, Medium). A payment captured but `checkoutComplete` failure leaves a charged order with no compensating void/refund (Medium). Best-effort error swallowing causes fail-open spending caps (`fetchSpentAggregates` returns zero spend on Payload outage) and hides infra failures (`limits.ts:202-204`, `auth.ts:318-324`, Medium).

**Tests.** Test infrastructure is solid (506 it/test blocks, good mocking, env/bucket resets), but coverage of the highest-risk boundary is actively harmful: existing integration tests codify the IDOR as correct (`__tests__/.../orders.test.ts:73-87` asserts an order is returned for any dev bearer with no owner check) (High). There are no tests for the two unauthenticated/over-privileged fallbacks (legacy full-scope bearer, MCP `validateApiKey(undefined)===true`) (High), and no negative tests for JWT `alg`/header tampering despite the embedded-Saleor-token blast radius (Medium). Worst of all, CI never gates types/tests/lint on pull requests — `lint.yml` runs only post-deploy on `deployment_status==success`, so broken types, failing tests, and lint violations can merge and ship undetected (High).

**Performance.** The most impactful offender is the global request queue in `graphql.ts:124-181` that throttles _every_ server-side Saleor query with an unconditional `Promise.all([fn(), sleep(minDelayMs)])` — adding a hard ~200ms floor even to 20ms cache hits and capping the whole process to 3 concurrent Saleor requests, serializing fan-out pages and inflating TTFB (High). The agent-protocol `saleorQuery` issues uncached live queries for every UCP/ACP/MCP request including highly cacheable catalog reads (Medium), and the checkout-complete path fetches the same checkout three times per request (`complete/route.ts:74,103,171`, Medium). The agent activity logger does a wasted GET before every POST (`agent-log.ts:143-154`, Low), and `revokedTokens` grows unbounded with no pruning despite the misleading "tokens expire" comment (`tokens.ts:155-167`, Low). PDP/PLP/home server components were checked clean (`"use cache"` + Suspense, batched slug resolution, no obvious N+1).

### 5. Prioritized Remediation Roadmap

**Quick wins (high impact, low effort) — do these first:**

- Remove the `{ hostname: "*" }` remotePatterns entry (open image proxy/SSRF) — one-line gate behind `NODE_ENV==='development'`.
- Escape JSON-LD output: apply the existing `serve-html.ts` `<`/`>`/`&` escape in a single `JsonLdScript` helper and route all call sites through it (stored XSS).
- Make the Saleor webhook fail closed when `SALEOR_WEBHOOK_SECRET` is unset (one missing `else`).
- Make `validateApiKey(undefined)` return false, and stop registering `complete_checkout`/`create/update`/`get_*_full` on the public `/mcp` transport.
- Fail closed when `AGENT_API_KEYS` is unset in production; give the synthetic anonymous identity empty scope + zero cap.
- Add the security-headers `headers()` block (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy; `frame-ancestors 'none'` on `/oauth/*`).
- Switch `lint.yml` to `pnpm install --frozen-lockfile`; add a `pull_request`-triggered CI job running `tsc --noEmit`, lint, and `test:run` as required checks.

**Fix now (Critical/High, before any production or multi-tenant exposure):**

- Enforce object-level ownership on every UCP/ACP/MCP resource route (orders/carts/checkouts/returns/approvals): query Saleor authenticated as the customer's `saleorToken` and/or compare resource owner to `auth.userContext`; for agent-signed routes, bind `agent_id` into checkout metadata at create and verify on read/complete. (Merged IDOR + approval-status + MCP PII findings.)
- Route ACP checkout completion through the same `withUcpRoute`-equivalent guard chain (scope + limits + approval); delete the deprecated `validateAgentApiKey`/`validateOAuthToken` (also resolves the parallel-auth-path quality finding).
- Rework the ed25519 signature scheme: canonical signing input (method+path+query+timestamp+nonce+body hash), skew window, persistent nonce store; treat body-read failure as 401.
- Stop embedding Saleor access/refresh tokens in JWTs — store server-side keyed by `jti` or encrypt (JWE).
- Validate and filter `webhook_url` before fetch (SSRF): scheme + post-DNS private-IP block + per-agent allowlist + `redirect:'manual'`.
- Make checkout completion and returns idempotent and atomic (idempotency keys; Saleor-side refund/charge state instead of in-memory dedup).

**Fix this sprint (Medium):**

- Back auth codes, revoked refresh JTIs, and rate/spend counters with Redis/DB; make `per_session_cents` cumulative and fail closed when the spend store is unavailable.
- Add per-IP/per-account rate limiting and lockout on OAuth login/token and reset-password.
- Enforce consented OAuth scope (intersect `payload.scope` with mapped agent scope; stop defaulting unmapped clients to full scope); implement or remove `allowed_scopes`.
- On refresh, call Saleor `tokenRefresh` and rebind/rotate; fix `verifyJwt` base64url decode and assert `alg==='HS256'`.
- Decouple the global Saleor request queue from latency (drop the unconditional sleep; only back off on observed 429s; exempt cache hits); add caching to read-only protocol queries; collapse the triple checkout fetch.
- Deduplicate the MCP `validateApiKey` and ACP PATCH apply blocks into shared helpers; fix the misleading `complete_checkout` fallback receipt; add charge-without-completion compensation.
- Add the missing negative/authorization tests (IDOR 403, fail-open fallbacks, JWT alg tampering) — these will correctly fail today and surface regressions.

**Backlog / hardening (Low/Info):**

- Pin caret-ranged deps to exact versions; cap OG/cart-line input sizes; timing-safe compares on revalidate/cron secrets; generic upstream error messages; `Secure` cookie flag + `poweredByHeader: false`; gate ephemeral signing key behind an explicit flag with `kid` rotation; prune `revokedTokens`; remove the wasted activity-log GET; tighten tsconfig (`allowUnreachableCode: false`).

### 6. Coverage & Caveats

**What was reviewed.** The audit prioritized the agent-protocol and money/identity core: the unified auth layer (`auth.ts`), `withUcpRoute`/`route-handler.ts`, the OAuth2 AS (`src/lib/oauth/*`, `src/app/oauth/*`), the UCP/ACP REST routes (orders, carts, lines, checkout-sessions complete/cancel, returns, approvals, catalog search), the MCP server and tools (`src/mcp-server/*`, `src/app/mcp/route.ts`), the shared Saleor gateway, payments (`payment.ts`), signing (`signing.ts`), limits (`limits.ts`), webhooks (Saleor + revalidate), cron, the OG/draft/feed routes, SEO JSON-LD sinks, `next.config.js`, `middleware.ts`, package/CI/Docker supply-chain config, and the test suite for the critical paths.

**Sampling strategy & verification.** Findings were produced by finder agents and, for security, confirmed by ≥2 of 3 adversarial verifiers (most by 3/3). Duplicate findings (the IDOR class reported six times, the legacy fail-open three times, the MCP unauth exposure three times, the embedded-token issue five times, the in-memory-state issue and missing-headers issue twice each) were merged, and severities were normalized across copies (e.g., the IDOR set is uniformly High). **Six candidate findings were dropped as likely false-positives during adversarial verification** (0–1/3 votes): (1) OAuth consent CSRF / no-real-consent-step (0/3); (2) webhook only supports HMAC-hex, not Saleor's default JWS RS256 (1/3); (3) webhook compares hex digest against raw header pushing operators to disable verification (1/3); (4) rich-text description sanitized only by `xss()` default allowlist (1/3); (5) outdated pinned `sharp@0.33.2` direct dependency (1/3); (6) `verifyJwt` does not validate header `alg`/`typ` exploitable (0/3 — the implementation ignores the declared `alg` and recomputes HMAC, so it is not exploitable as written, though it lacks a regression test).

**What was NOT reviewed.**

- Generated GraphQL code: `src/gql/graphql.ts` (~35k lines) and `src/checkout/graphql/generated` (~34k lines) — codegen output, out of scope.
- Storefront UI components were not weighed for complexity/bundle size: `graphql-monitor.tsx` (683 lines), `filter-bar.tsx` (489), `payment-step.tsx` (450), `information-step.tsx` (494). No client bundle sizes were measured (no build run).
- Several modules were not opened end-to-end: `src/lib/oauth/pkce.ts`, `saleor-auth.ts`, `approvals.ts`, and parts of `return-mapper.ts` — PKCE correctness, `saleorLogin` error handling, and approval-store durability are not independently assessed.
- Not every one of the ~31 protocol routes was traced end to end; only checkout-complete was fully traced for duplicate-fetch behavior (others likely make a single `saleorQuery` but share the no-cache/IDOR limitations).

**UNVERIFIED assumptions (mandatory disclosure).**

- The exact reach of the IDOR depends on whether Saleor returns data for arbitrary opaque IDs over an unauthenticated request; this was reasoned from the storefront code (which unambiguously omits ownership checks) but not confirmed against the live Saleor instance. Order/checkout ID enumerability also varies by Saleor deployment.
- The JWT `alg`-confusion path is assessed non-exploitable by reading the implementation, not by running a forged-token test.
- The unhandled-throw findings assume Next.js wraps an awaited handler throw into a 500 rather than crashing the worker — runtime behavior was not confirmed.
- The test suite was not executed (`vitest run`/`tsc --noEmit` were not run); it was only confirmed that neither is gated in CI on PRs. Per-file test quality beyond the auth/oauth/payment/route critical paths is not fully characterized.
- `.env` was confirmed to contain only non-secret `NEXT_PUBLIC_*` values and is not git-tracked; no other secret material was independently audited at the deployment layer.
