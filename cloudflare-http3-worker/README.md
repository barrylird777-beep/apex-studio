# APEX optional HTTP/3 edge (free-tier proof)

This is an **optional alternate edge endpoint**, not a change to the canonical Railway deployment.

## What it does

- Runs as a Cloudflare Worker on the free `workers.dev` hostname.
- Proxies requests only to the fixed HTTPS origin `apex-studio-production.up.railway.app`; it is not an arbitrary-URL proxy.
- Preserves streaming request/response bodies and query strings.
- Disables caching and strips hop-by-hop and caller-supplied forwarding headers.
- Keeps same-origin redirects on the Worker hostname when the upstream points back to the configured origin.

The browser-to-Cloudflare connection can negotiate HTTP/3/QUIC if Cloudflare serves HTTP/3 for the assigned `workers.dev` hostname and the client network supports UDP/QUIC. The Worker-to-Railway hop remains HTTPS; it does not turn Railway's edge into HTTP/3.

## Deploy without a paid plan

**Phone-friendly path using GitHub Actions:**

1. Sign in to Cloudflare and confirm Workers Free is available.
2. In Cloudflare, create an API token with only the permissions needed to deploy Workers, and copy the account ID.
3. In the GitHub repository settings, add Actions secrets named `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Never put either value in source code, issues, or chat.
4. After this PR is merged, open **Actions → Deploy optional APEX HTTP/3 edge → Run workflow**.
5. Open the resulting `*.workers.dev` URL from the workflow output or Cloudflare dashboard.

Alternative CLI path from this directory: `npx wrangler deploy`.

## Verify the actual protocol

From an HTTP/3-capable client, run:

```sh
curl --http3-only -I https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/
```

A successful HTTP response with HTTP/3 negotiated is required. A DNS/QUIC failure is not proof of HTTP/3. Then check app login, API calls, uploads, redirects, and streaming on the alternate hostname before considering any broader rollout.

## Important limits

- This does **not** change or remove the Railway hostname and does not make Railway's public edge support HTTP/3.
- The Railway origin remains directly reachable, so this does not force every client through Cloudflare.
- A `workers.dev` hostname is an alternate test endpoint, not the canonical branded APEX domain. Using a custom APEX domain requires domain/DNS control and additional configuration.
- Do not add secrets to this Worker or commit them to Git.
- No database, disk, paid resource, or new APEX service is provisioned by this source change.
- Do not claim HTTP/3 is live until the deployed endpoint is tested from a real HTTP/3-capable client.

## Rollback

Stop using the alternate `workers.dev` URL and delete the Worker from Cloudflare. The existing Railway endpoint is unchanged by this Worker source.
