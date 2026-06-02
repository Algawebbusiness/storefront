# Agent request signing (UCP/ACP B3)

Agents authenticate to the storefront's UCP/ACP REST endpoints with an **ed25519
signature over a canonical request string**. This binds the signature to the
HTTP method, path, a timestamp, and a per-request nonce, so a captured
signature cannot be replayed against another verb/path/resource or reused
(CWE-347). The scheme is also published, machine-readable, at
`GET /.well-known/ucp` under `request_signing`.

> **Discovery:** read `/.well-known/ucp` → `signing_keys` (the storefront's own
> response-signing keys) and `request_signing` (this contract). Register your
> agent's **public** key with the operator; sign with the matching private key.

## Required headers

| Header          | Value                                                               |
| --------------- | ------------------------------------------------------------------- |
| `UCP-Agent`     | your agent id, or `id="<id>",profile="<url>"`                       |
| `UCP-Timestamp` | Unix epoch **seconds**. Rejected if > 300 s from server time.       |
| `UCP-Nonce`     | unique per request (e.g. random 128-bit hex). Replays are rejected. |
| `UCP-Signature` | `keyid="<kid>",alg="ed25519",sig="<base64(signature)>"`             |

## Canonical string (what you sign)

Join these five fields with a single `\n` (newline), in order:

```
<METHOD>            # uppercase, e.g. POST
<PATH_AND_QUERY>    # e.g. /api/ucp/rest/orders/abc?expand=lines
<TIMESTAMP>         # same value as the UCP-Timestamp header
<NONCE>             # same value as the UCP-Nonce header
<BODY_SHA256_HEX>   # lowercase hex SHA-256 of the raw body; hash "" if no body
```

Sign the UTF-8 bytes of that string with your ed25519 private key, base64-encode
the 64-byte signature, and put it in `UCP-Signature`.

## Reference (JavaScript / Web Crypto)

```js
async function signUcpRequest({ method, url, body = "", privateKey, agentId, kid }) {
	const u = new URL(url);
	const timestamp = String(Math.floor(Date.now() / 1000));
	const nonce = crypto.randomUUID().replace(/-/g, "");

	const bodyHash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)))]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");

	const canonical = [method.toUpperCase(), u.pathname + u.search, timestamp, nonce, bodyHash].join("\n");

	const sig = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(canonical));
	const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)));

	return {
		"UCP-Agent": agentId,
		"UCP-Timestamp": timestamp,
		"UCP-Nonce": nonce,
		"UCP-Signature": `keyid="${kid}",alg="ed25519",sig="${sigB64}"`,
	};
}
```

The server rebuilds the identical canonical string and verifies it with the
agent's registered public key (`buildSigningString` / `verifySignedRequest` in
`src/lib/protocols/shared/{signing,auth}.ts`).

## Common pitfalls

- **Hash the body even when empty** — bodiless GET/DELETE sign `sha256("")`
  (`e3b0c442...`), not an empty field.
- **Path must include the query string** exactly as sent.
- **Timestamp is seconds, not milliseconds.**
- **Reuse a nonce → 401.** Generate a fresh one per request.
- Clock skew over **300 s** → 401. Sync your clock.
