# Mizmar

Invoicing, multi-warehouse stock and commercial documents (Devis → Bon de commande → Bon de livraison → Facture → Avoir, plus the purchase side), with a configurable FR/EN/AR PDF layout.

| App | Stack | Port |
|---|---|---|
| `apps/api` | NestJS 11 (Fastify), Prisma, PostgreSQL 17, headless Chrome for PDF | 3001 |
| `apps/web` | Next.js 15, React 19, Tailwind 4 | 3000 |
| `apps/mobile` | Expo SDK 57, expo-router, offline outbox (SQLite) | — |

Business rules live once, in `packages/core` (totals, status machine, stock-impact resolver, conversion, permissions), and run in the API, the web editor and the phone.

## Run it

```sh
pnpm install
pnpm infra:up                 # postgres, redis, S3 (SeaweedFS), mailpit
pnpm db:migrate && pnpm db:seed
pnpm --filter @mizmar/api build && pnpm --filter @mizmar/api start
pnpm --filter @mizmar/web dev
pnpm --filter @mizmar/mobile dev
```

Sign in with `owner@mizmar.ma` / `Mizmar2026!` (also `accountant@`, `sales@`, `warehouse@`). Mail lands in Mailpit at :8025.

PDF rendering needs Chrome/Chromium; set `CHROMIUM_PATH` if it is not in a standard location.

## Verify

```sh
pnpm typecheck && pnpm test
bash tooling/smoke/pipeline.sh   # against a fresh seed, with the API running
```
