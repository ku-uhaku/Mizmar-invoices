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

Sign in with `owner@mizmar.ma` or the username `owner`, password `Mizmar2026!` (also `accountant`, `sales`, `warehouse`). Login accepts an email or a username; "Mot de passe oublié ?" emails a reset link (Mailpit in dev). Mail lands in Mailpit at :8025.

PDF rendering needs Chrome/Chromium; set `CHROMIUM_PATH` if it is not in a standard location.

## Verify

```sh
pnpm typecheck && pnpm test
bash tooling/smoke/pipeline.sh   # against a fresh seed, with the API running
```

## WhatsApp (optional)

Documents and overdue reminders can also be sent to the customer on WhatsApp through a self-hosted [OpenWA](https://github.com/rmyndharis/OpenWA) gateway.

1. Run OpenWA next to the stack (it builds from its own repo):
   `git clone https://github.com/rmyndharis/OpenWA && cd OpenWA && docker compose -f docker-compose.dev.yml up -d`
2. Read the admin key: `docker exec openwa-api cat /app/data/.api-key`.
3. Create and start a session (dashboard at http://localhost:2785, or `POST /api/sessions` then `/start`) and note its id.
4. Set `OPENWA_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION_ID` in `.env` and restart the API.
5. Open **Settings → WhatsApp** and scan the QR code with the sending phone.
6. Apply the migration: `pnpm db:migrate` (adds the `WHATSAPP` reminder channel).

With the variables unset, all WhatsApp options are hidden and email works as before. OpenWA is an unofficial gateway: use a dedicated number, as WhatsApp may restrict it.
