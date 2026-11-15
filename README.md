# Switchboard — Multi-Provider Payment Router

A simulation-only portfolio demo: **Next.js + TypeScript + PostgreSQL**. Two fictional providers, Atlas and Beacon. No card details, credentials, payment SDKs, or real money.

## Local setup

Node.js 22+ and Docker Compose are required.

```sh
npm ci
docker compose up -d --wait
cp .env.example .env.local
# Replace WEBHOOK_SECRET with a random value before deploying.
set -a; . ./.env.local; set +a
npm run db:migrate
npm test
npm run dev
```

For a production build: `npm run typecheck && npm run build && npm start`.

## Safety model

- An order UUID has exactly one persistent payment intent (unique PostgreSQL constraint). Amount is always **4999 integer cents, EUR**, assigned server-side.
- Every provider attempt is committed **before dispatch**. Each intent/provider pair has a stable, unique idempotency key. Retries reuse the original request, not a fresh attempt.
- PostgreSQL intent row locks serialize routing and webhook transitions across application instances. Transactions are short except for the simulator call; the simulator has a separate connection pool and independently commits its ledger, like an external provider.
- An ambiguous timeout remains `pending`. Only reconciliation with the original provider can resolve it. A missing lookup is also unknown, not permission to fail over. There is no elapsed-time failover rule.
- Failover is possible **only** after `not_sent` or a terminal `no_charge`. A card decline ends the payment in this demo; no decline-shopping.
- Signed webhooks are matched to the recorded provider/key, deduplicated by provider/event ID, and reconciled against the authoritative simulator outcome. Untrusted event outcomes are not applied directly.
- A crash after a provider charge but before the router transaction commits leaves a prepared attempt. Replaying its stable key recovers the original charge.
- The independent simulator ledger deliberately has **no per-intent charge uniqueness constraint**. Tests count actual charges across both providers so a double-charge routing bug cannot be hidden by the test database.

The demo settles delayed requests lazily when a retry, reconciliation, or webhook checks the provider. It does not require in-memory timers, queues, or a long-running worker. Closing the browser stops automatic reconciliation, not the provider's durable result; reopening and checking the same payment settles it. An unresolved timeout intentionally never settles.

## Boundaries

This is not a production payment system. Production integrations need real provider contracts, authenticated merchant access, provider signature/timestamp verification, operational reconciliation workers, PII/security controls, abuse prevention, and provider-specific guarantees that a no-charge result is truly terminal. A public payment UUID is an unguessable demo capability; it is not a merchant authentication system. Demo data is persistent and contains no personal or card information.

Use a PostgreSQL service reachable by the hosting platform, set `DATABASE_URL` and a random `WEBHOOK_SECRET`, and run `npm run db:migrate` once before serving. SSL should be configured in the database connection URL as required by the database host. Budget at least 16 database connections per active app instance or reduce the two pool limits. Next.js uses the Node runtime, not Edge. No filesystem persistence is used.
