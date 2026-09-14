# Contributing

## Setup

```bash
npm install
npm run db:up                              # Postgres in Docker
cp apps/api/.env.example apps/api/.env     # then set JWT_SECRET
npm run db:migrate
npm run db:seed
npm run dev                                 # api :3001, web :3000
```

## Before opening a PR

```bash
npm run typecheck
npm run test          # API unit tests
npm run test:e2e      # API end-to-end tests — needs Postgres (npm run db:up)
npm run build
```

CI (`.github/workflows/ci.yml`) runs the same four commands against a disposable database on every push
and PR — a PR that's red there will be red locally too.

## Conventions

- **The ledger is the only writer of accounting state.** New postings go through
  [`LedgerService.post`](apps/api/src/accounting/ledger.service.ts); don't create `JournalLine` rows any
  other way. See [ARCHITECTURE.md](ARCHITECTURE.md) for why.
- **Money** uses `Prisma.Decimal` end to end (see [`common/money.ts`](apps/api/src/common/money.ts)) — never
  `Number` for anything that gets summed or compared for equality.
- **Validation** is Zod schemas passed to `ZodPipe`, not DTO classes — this is also what the OpenAPI docs
  are generated from (`common/swagger.ts`), so a route's Swagger schema can't drift from what it actually
  validates.
- **Dates** for business documents are UTC day boundaries (`common/dates.ts`); don't reach for the local
  timezone `Date` constructor for anything stored.
- A new module gets a `<name>.module.ts` (controller + service in one file for small modules, split out
  once either grows) and, if other modules need to call into it, an explicit `exports: […]` — nothing is
  exported by default.

## Tests

- **Unit tests** (`*.spec.ts`, next to the code) — pure logic, no database. `money.spec.ts`,
  `allocate.spec.ts`, `ledger.service.spec.ts` (with a hand-built fake `Tx`) are the pattern to follow.
- **E2E tests** (`apps/api/test/*.e2e-spec.ts`) — boot the real Nest app against a disposable `*_test`
  database (see `test/global-setup.ts`), drive it through `supertest`, and assert on the accounting
  invariants (trial balance balances, stock reconciles to the GL), not just individual response shapes.
  `test/helpers.ts` has the `client()` wrapper used throughout — prefer it over raw `supertest` calls.

## Reporting a security issue

Please don't open a public issue for a vulnerability. Open a private security advisory on the repository
instead ("Security" tab → "Report a vulnerability").
