# Security and production edge profile

The default local profile stays easy to review: it listens on port 3000 and authentication
is off. The supplied production profile fails closed, enables scoped service credentials,
and exposes only an HTTPS gateway. Secrets and certificates are deployment inputs and are
not committed.

## Implemented controls

| Control | Enforcement | Default / configuration | Verification |
|---|---|---|---|
| Rate limiting | `express-rate-limit` on `/graphql`; NGINX also limits request and connection bursts | 60 requests/IP/minute in app (`RATE_LIMIT_*`); 5 requests/IP/second with burst 20 at gateway | `rate-limit.e2e-spec.ts` |
| GraphQL demand control | Validation rule runs before resolvers and expands fragments | depth 8, aliases 15, root fields 4, weighted complexity 100 | unit + security e2e tests |
| Authentication | Optional service API key via `Authorization: Bearer` or `X-API-Key`; SHA-256 digests compared in constant time | Off locally; `AUTH_REQUIRED=true` in secure compose | security e2e tests |
| Authorization | Both queries require `forecast:read`; credentials carry explicit scopes | `AUTH_API_KEYS_JSON` | security e2e tests |
| CORS | Exact origin allow list; no wildcard, credentials disabled, POST/OPTIONS only | empty list locally (cross-origin browser access off) | config + security e2e tests |
| TLS | NGINX terminates TLS 1.2/1.3 and redirects HTTP to HTTPS | certificate/key mounted under `deploy/certs` | inspect/test deployed gateway |
| Body limit | Express JSON/form parsers and NGINX enforce the limit | 16 KiB (`REQUEST_BODY_LIMIT`; keep gateway value aligned) | security e2e test |
| Gateway protection | exact route, method allow list, rate/connection/body/time limits, hidden version, overwritten forwarding headers | secure compose profile | NGINX config review/deployment smoke test |
| Response hardening | Helmet headers; Express signature disabled; GraphiQL/introspection/stack traces off in production | enabled | security e2e test |
| Upstream containment | outbound timeouts and controlled provider URLs | 10 seconds (`HTTP_TIMEOUT_MS`) | adapter tests |

The NGINX configuration is a protective API gateway, not a signature-based WAF. On a public
cloud deployment, place a managed WAF/DDoS service in front when bot mitigation, IP
reputation, geo policy or managed exploit signatures are required. Do not claim that layer
is active until the chosen platform has actually provisioned and tested it.

## Start the HTTPS profile

1. Provision a certificate for the deployment hostname as
   `deploy/certs/fullchain.pem` and its private key as `deploy/certs/privkey.pem`.
2. Generate a random API secret of at least 32 characters and store it in the deployment
   secret manager.
3. Export `SERVER_NAME`, `CORS_ALLOWED_ORIGINS`, and `AUTH_API_KEYS_JSON`, for example with
   the JSON shape below (substitute a real secret; do not commit it):

   ```json
   [{"subject":"web-client","key":"<random-secret-at-least-32-characters>","scopes":["forecast:read"]}]
   ```

4. Start the profile:

   ```bash
   docker compose -f deploy/docker-compose.secure.yml up --build
   ```

5. Call `https://<SERVER_NAME>/graphql` with `Authorization: Bearer <key>`.

The API container has no host port in this profile. `TRUST_PROXY_HOPS=1` matches exactly one
NGINX hop, and NGINX replaces client-supplied forwarding headers so IP-based limits cannot
be bypassed with a forged `X-Forwarded-For` value.

## Operational limits and follow-ups

- The app limiter is in memory and the NGINX zones are per gateway instance. A horizontally
  scaled deployment needs a shared limiter (for example Redis) or a centrally enforced API
  gateway quota keyed by authenticated client as well as IP.
- API keys are for service clients, not end-user identity. A metered public product should
  use managed OIDC/JWT or gateway-issued keys, rotation/revocation, per-subject quotas and
  audit events. Never put credentials in query strings.
- HSTS is intentionally omitted from this reusable template. Enable it at the real edge only
  after HTTPS works permanently for the production domain and subdomain policy is understood.
- TLS certificate issuance/renewal and managed-WAF policy depend on the hosting platform;
  the repository supplies the termination/gateway contract but does not pretend to provision
  external infrastructure.
- SQLite and the in-memory single-flight/rate-limit state keep this a single-instance
  take-home. Multi-instance production requires Postgres, migrations, shared coordination,
  centralized logs/metrics and secret-manager injection.
- `npm audit --omit=dev` reports zero production vulnerabilities. The full-tree audit
  currently reports 20 moderate dependency-path findings in Jest/ts-jest coverage tooling,
  ending in `sprintf-js <=1.1.3`. The
  [published advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c) has no patched
  version at the time of this review, and npm's suggested “fix” downgrades the test stack
  incompatibly, so it was not applied blindly. This code is absent from the production image;
  keep CI inputs trusted and upgrade the test chain when upstream publishes a compatible
  resolution.
