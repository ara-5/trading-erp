# Trading ERP

[![CI](https://github.com/ara-5/trading-erp/actions/workflows/ci.yml/badge.svg)](https://github.com/ara-5/trading-erp/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPLv3-blue.svg)](LICENSE)

A full-stack ERP for a trading company — **accounting, inventory, purchasing, sales/CRM and HR/payroll**
on one double-entry general ledger, plus an AI copilot for answering questions over live business data. See
[ARCHITECTURE.md](ARCHITECTURE.md) for how the ledger, concurrency, auth and copilot are actually built,
not just what they do.

| Layer      | Tech                                                              |
| ---------- | ------------------------------------------------------------------ |
| Frontend   | Next.js 15 (App Router), React 19, Tailwind CSS 4, TanStack Query |
| Backend    | NestJS 11, Prisma 6, Zod validation, JWT + rotating refresh tokens |
| Database   | PostgreSQL 17                                                     |
| AI         | Claude (`@anthropic-ai/sdk`) — chat + document extraction, both optional |

## Quick start

### Docker (fastest)

Requires Docker.

```bash
cp .env.example .env               # set JWT_SECRET — see the comment in the file for how to generate one
docker compose up -d                # postgres, migrate (runs once), api, web
docker compose --profile tools run --rm seed   # chart of accounts, admin user, demo master data
```

Open **http://localhost:3000** and sign in with `admin@erp.local` / `Admin@12345` — **change this password
immediately**, or set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` in `.env` before seeding. Want six months
of realistic transaction history instead of an empty dashboard? `docker compose --profile tools run --rm
demo` (after `seed`).

### Without Docker

Requires Node 20+ and a local Postgres, or just `docker compose up -d postgres` for the database alone
(still needs `.env` at the repo root — see above, compose validates every service's config up front).

```bash
npm install
npm run db:up                              # Postgres only
cp apps/api/.env.example apps/api/.env     # then set JWT_SECRET
npm run db:migrate
npm run db:seed
npm run db:demo                            # optional — six months of demo transactions (needs the API running)
npm run dev                                # api on :3001, web on :3000
```

## Modules

**Sales & CRM** — leads pipeline → customers → quotations → sales orders → partial deliveries → invoices →
payments. Credit limits are enforced when confirming an order.

**Purchasing** — suppliers → purchase orders (approval) → partial goods receipts → bills → payments. Bills
can also be raised directly for expenses against any GL account.

**Inventory** — products and services, multiple warehouses, transfers, adjustments, full movement history,
low-stock alerts, and moving weighted-average costing.

**Accounting** — hierarchical chart of accounts, manual journals (draft → post → void), payments (including
voiding one, which reopens the invoice/bill it was applied to), bank reconciliation, year-end close, and
reports: profit & loss, balance sheet, trial balance, general ledger, receivables/payables aging. PDF
generation for invoices, quotations, purchase orders and payslips.

**HR & Payroll** — departments, employees, daily attendance, leave types with yearly entitlements and
balance checks, and payroll runs (unpaid-leave deduction, overtime, tax, other deductions → approve → pay).

**Administration** — company profile and currency, role-based users, GL system-account mapping, tax rates,
audit log of every change.

**AI copilot** — a floating chat widget that answers questions ("what's overdue?", "any products low on
stock?") using a fixed set of read-only tools, gated by the same roles as the REST routes behind them —
see [ARCHITECTURE.md](ARCHITECTURE.md#where-the-ai-copilots-authority-ends). It can also read a scanned
supplier bill (PDF or photo) and pre-fill the New Bill form from it. Both features are optional: set
`ANTHROPIC_API_KEY` in `apps/api/.env` to enable them; the UI hides them cleanly when it's unset.

## Roles

`ADMIN` (everything), `ACCOUNTANT`, `SALES`, `PURCHASING`, `INVENTORY`, `HR`, `VIEWER`. Enforced on every
API route (`@Roles(...)`) and mirrored in the sidebar and the copilot's tool list — a role never sees a
capability its API access wouldn't allow anyway.

## API docs

With the API running, interactive OpenAPI docs are at **http://localhost:3001/api/docs** — generated from
the same Zod schemas that validate each request, so they can't drift from what the API actually accepts.

## Testing

```bash
npm run typecheck
npm run test          # API unit tests — pure logic, no database
npm run test:e2e      # API end-to-end tests — boots the real app against a disposable erp_test database
```

The e2e suite drives full business cycles (quote → order → delivery → invoice → payment; PO → receipt →
bill → payment; a payroll run; bank reconciliation; year-end close) through the real HTTP API and asserts
on the accounting invariants that tie them together — the trial balance balances, the balance sheet
balances, and GL inventory equals the stock valuation — not just that each response looks right in
isolation. Runs in CI on every push and PR.

## Project layout

```
apps/
  api/                 NestJS API  (http://localhost:3001/api)
    prisma/            schema, migrations, seed, demo-data
    test/              e2e tests + helpers
    src/
      accounting/      ledger, accounts, journals, payments, reports, banking, year-end close
      inventory/       products, warehouses, stock service (costing)
      purchasing/      suppliers, purchase orders, bills
      sales/           customers, leads, quotations, orders, invoices
      hr/              employees, attendance, leave, payroll
      copilot/         AI chat tools + document extraction
      admin/ auth/ dashboard/ common/
  web/                 Next.js frontend (http://localhost:3000)
    src/app/(app)/     one folder per module
    src/components/    UI kit, list page, document form, line items, modals, copilot widget
```

## Scripts

| Command               | What it does                                          |
| ---------------------- | ------------------------------------------------------ |
| `npm run dev`          | API + web in watch mode                                |
| `npm run build`        | Production build of both apps                          |
| `npm run typecheck`    | Type-check both apps                                    |
| `npm run test`         | API unit tests                                          |
| `npm run test:e2e`     | API end-to-end tests (needs Postgres)                    |
| `npm run db:migrate`   | Apply Prisma migrations                                  |
| `npm run db:seed`      | Seed reference data + admin user (idempotent)             |
| `npm run db:demo`      | Six months of demo transactions (needs the API running)  |
| `npm run db:down`      | Stop Postgres                                            |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Changes are tracked in [CHANGELOG.md](CHANGELOG.md).

## License

Copyright © 2026 Ara. Licensed under the [GNU Affero General Public License v3.0](LICENSE).

You may use, modify and redistribute this software, but modified versions must also be released under
AGPL-3.0 — including when you run them as a network service for others (section 13), in which case you
must offer those users the corresponding source code.
