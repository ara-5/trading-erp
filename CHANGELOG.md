# Changelog

## v0.3.0

**Security**
- Optional TOTP two-factor authentication (`apps/api/src/auth/auth.module.ts`) — QR-code enrollment, 8
  single-use recovery codes, and a stateless short-lived login challenge so a 2FA-enabled account needs a
  code from the second step before a session is ever issued

**Analytics**
- A new `/accounting/analytics` endpoint and page: 12-month cash balance, income vs. expense, net profit
  trend, receivables/payables aging, and top customers, charted with Recharts

**UX**
- Dark mode — light/dark/system toggle in the sidebar, applied across the shared UI kit and every page
- Command palette (`⌘K`/`Ctrl+K`) — fuzzy navigation plus quick-create actions, filtered by role

## v0.2.0

**Security & auth**
- Refresh-token rotation in an httpOnly cookie, with reuse detection that revokes every session for the
  account
- Forced password change for admin-created/reset accounts
- Login rate limiting, a global request rate limit, and `helmet` security headers
- Read-only `DEMO_MODE` for public demos

**Accounting**
- Bank reconciliation: statement import, auto-matching, manual matching, and posting a journal entry
  directly from an unmatched statement line
- Year-end close (locks the period, zeroes income/expense into retained earnings) and reopen
- Payment voiding, reopening the invoice/bill it was applied to
- PDF generation for invoices, quotations, purchase orders and payslips

**AI copilot** *(new)*
- Streaming chat over ~11 read-only business-data tools, gated by the same roles as the matching REST
  routes — see [ARCHITECTURE.md](ARCHITECTURE.md#where-the-ai-copilots-authority-ends)
- Document extraction: turns a photographed/scanned supplier bill into a structured draft that pre-fills
  the New Bill form

**Developer experience**
- OpenAPI/Swagger docs at `/api/docs`, generated from the same Zod schemas that validate requests
- Jest unit and end-to-end tests, run in CI (GitHub Actions) against a disposable Postgres database
- `npm run db:demo` — six months of realistic transaction history driven through the real API
- Docker Compose for the full stack (Postgres + API + web), with multi-stage production Dockerfiles

## v0.1.0

Initial release: accounting (chart of accounts, manual journals, payments, reports), inventory
(multi-warehouse, weighted-average costing), purchasing, sales/CRM, and HR/payroll, on a shared
double-entry ledger.
