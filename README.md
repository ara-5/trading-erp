# ERP

A full-stack ERP for a single trading company: **accounting, inventory, purchasing, sales/CRM and HR/payroll** on one double-entry general ledger.

| Layer    | Tech                                                        |
| -------- | ----------------------------------------------------------- |
| Frontend | Next.js 15 (App Router), React 19, Tailwind CSS 4, TanStack Query |
| Backend  | NestJS 11, Prisma 6, Zod validation, JWT auth               |
| Database | PostgreSQL 17 (Docker)                                      |

## Quick start

Requires Node 20+ and Docker.

```bash
npm install
npm run db:up                             # start Postgres
cp apps/api/.env.example apps/api/.env    # then set JWT_SECRET
npm run db:migrate                        # create tables
npm run db:seed                           # chart of accounts, admin user, demo master data
npm run dev                               # API on :3001, web on :3000
```

Open http://localhost:3000 and sign in with **admin@erp.local / Admin@12345** — change this password immediately (or set `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` before seeding).

## Modules

**Sales & CRM** — leads pipeline → customers → quotations → sales orders → partial deliveries → invoices → payments. Credit limits are enforced when confirming orders.

**Purchasing** — suppliers → purchase orders (approval) → partial goods receipts → bills → payments. Bills can also be raised directly for expenses against any GL account.

**Inventory** — products and services, multiple warehouses, transfers, adjustments, full movement history, low-stock alerts and moving weighted-average costing.

**Accounting** — hierarchical chart of accounts, manual journals (draft → post → void), payments, and reports: profit & loss, balance sheet, trial balance, general ledger, receivables/payables aging.

**HR & Payroll** — departments, employees, daily attendance, leave types with yearly entitlements and balance checks, and payroll runs (unpaid-leave deduction, overtime, tax, other deductions → approve → pay).

**Administration** — company profile and currency, role-based users, GL system-account mapping, tax rates, audit log of every change.

## How the ledger stays correct

Every business document posts through a single `LedgerService` that rejects unbalanced entries. The automatic postings are:

| Event                   | Debit                                    | Credit                       |
| ----------------------- | ---------------------------------------- | ---------------------------- |
| Goods received (PO)     | Inventory                                | Goods received not billed    |
| Purchase bill posted    | GRNI (at receipt cost) / expense, input tax, price variance | Accounts payable |
| Sales delivery          | Cost of goods sold (average cost)        | Inventory                    |
| Sales invoice posted    | Accounts receivable                      | Sales revenue, output tax    |
| Payment received / made | Bank · Accounts payable                  | Accounts receivable · Bank   |
| Stock adjustment        | Inventory or adjustment expense          | the other                    |
| Payroll approved        | Salary expense                           | Salaries payable, withholdings |
| Payroll paid            | Salaries payable                         | Bank                         |

Stock-tracked items can only be invoiced or billed via orders, so stock and GL inventory always reconcile. Document numbers come from row-locked sequences, and stock issues use conditional updates, so concurrent users can't oversell or duplicate numbers.

## Roles

`ADMIN` (everything), `ACCOUNTANT`, `SALES`, `PURCHASING`, `INVENTORY`, `HR`, `VIEWER`. The API enforces roles per route; the sidebar hides modules a user can't access.

## Project layout

```
apps/
  api/                 NestJS API  (http://localhost:3001/api)
    prisma/            schema, migrations, seed
    src/
      accounting/      ledger, accounts, journals, payments, reports
      inventory/       products, warehouses, stock service (costing)
      purchasing/      suppliers, purchase orders, bills
      sales/           customers, leads, quotations, orders, invoices
      hr/              employees, attendance, leave, payroll
      admin/ auth/ dashboard/ common/
  web/                 Next.js frontend (http://localhost:3000)
    src/app/(app)/     one folder per module
    src/components/    UI kit, list page, document form, line items, modals
```

## Scripts

| Command              | What it does                         |
| -------------------- | ------------------------------------ |
| `npm run dev`        | API + web in watch mode              |
| `npm run build`      | Production build of both apps        |
| `npm run db:migrate` | Apply Prisma migrations              |
| `npm run db:seed`    | Seed reference and demo data (idempotent) |
| `npm run db:down`    | Stop Postgres                        |
