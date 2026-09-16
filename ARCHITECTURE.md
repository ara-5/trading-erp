# Architecture

This document explains the decisions that aren't obvious from the code layout — why the ledger is built
the way it is, how concurrency is handled, and where the AI copilot's boundaries are. For setup and the
module list, see [README.md](README.md).

## The one rule everything else follows

**Every balance the app shows is derived, at read time, from posted journal entries — never stored and
updated separately.** There is no `Account.balance` column. `GET /accounting/reports/trial-balance` and
every other balance figure runs `SUM(debit) - SUM(credit)` (or the reverse, for credit-normal accounts)
over `JournalLine` at request time. This is slower than a maintained running balance, but it makes an
entire category of bug structurally impossible: a balance and the entries behind it can never drift apart,
because there's only one source of truth to read from. At this application's scale, the query cost is
negligible; if it ever weren't, the fix is a materialized view refreshed from the same entries — not a
second, independently-updated number.

## The ledger is the only way to affect accounting state

[`LedgerService.post`](apps/api/src/accounting/ledger.service.ts) is the single entry point that writes to
`JournalLine`. Every other service — sales invoices, purchase bills, payments, stock adjustments, payroll —
calls it instead of touching journal tables directly. It:

1. Resolves `SystemAccountKey` references (`SALES_REVENUE`, `ACCOUNTS_RECEIVABLE`, …) to real account IDs,
   so callers ask for a role ("the tax payable account") rather than a hardcoded ID from seed data.
2. Rejects the whole entry if debits ≠ credits, if any line carries both a debit and a credit, or if any
   amount is negative — `assertBalanced` runs before anything is written.
3. Refuses to post into a locked period (see Year-end close, below).

The practical effect: it is not possible to construct an unbalanced journal entry through this codebase.
Every code path that creates money movement — post an invoice, receive a payment, adjust stock, run
payroll — goes through the same choke point and the same check.

## Postings, at a glance

| Event | Debit | Credit |
| --- | --- | --- |
| Goods received (PO) | Inventory | Goods received not billed (GRNI) |
| Purchase bill posted | GRNI (at receipt cost) or expense account, input tax, price variance | Accounts payable |
| Sales delivery | Cost of goods sold (moving average cost) | Inventory |
| Sales invoice posted | Accounts receivable | Sales revenue, output tax |
| Payment received / made | Bank · Accounts payable | Accounts receivable · Bank |
| Stock adjustment | Inventory or adjustment expense | the other side |
| Payroll approved | Salary expense | Salaries payable, withholdings |
| Payroll paid | Salaries payable | Bank |
| Year-end close | Every income/expense account back to zero | Retained earnings (net) |

## Why stock-tracked items can only be invoiced/billed from an order

A sales invoice for a tracked product can only be created via `POST /sales/orders/:id/invoice`, never
directly (`POST /sales/invoices` rejects a tracked product with no `salesOrderId`). Same for purchase
bills and purchase orders. This isn't a UI restriction — it's enforced in
[`SalesService.saveInvoice`](apps/api/src/sales/sales.module.ts) and the equivalent purchasing code.

The reason: stock value in the ledger (the `Inventory` account) only ever moves through
`StockService.receive` / `.issue`, driven by actual receipts and deliveries. If an invoice could book
revenue and COGS for a tracked product with no corresponding stock movement, the `Inventory` account
balance and `SUM(quantity × cost)` across `StockLevel` would silently diverge — and there'd be no query
that could tell you they had. Routing everything through the order's delivered/received quantities (see
`allocate()` in [`common/allocate.ts`](apps/api/src/common/allocate.ts), which spreads an invoice/bill
line's quantity across the matching order lines' remaining capacity) keeps the two in lockstep by
construction. `flows.e2e-spec.ts` asserts this reconciliation (`GL inventory equals stock valuation`)
directly, not just that each side is individually plausible.

## Concurrency: two different problems, two different fixes

**Document numbers** (`INV-00042`, `PO-00017`, …) are allocated by
[`SequenceService.next`](apps/api/src/common/common.module.ts), which does a Prisma `upsert` with
`next: { increment: 1 }` inside the caller's transaction. Postgres row-locks the `NumberSequence` row for
the transaction's duration, so two concurrent requests allocating the same sequence serialize on that one
row instead of racing — no gaps, no duplicates, without needing a separate distributed lock.

**Stock quantity** can't use the same pattern, because a decrement additionally needs a business-rule
check ("is there enough?") that has to be atomic with the decrement itself — checking then decrementing in
two steps leaves a window for two concurrent sales to both pass the check against the same on-hand
quantity. `StockService.issue` instead does the check and the write in one conditional `UPDATE`:

```ts
const { count } = await tx.stockLevel.updateMany({
  where: { productId, warehouseId, quantity: { gte: qty } },
  data: { quantity: { decrement: qty } },
});
if (count !== 1) throw new BadRequestException(`Insufficient stock…`);
```

Postgres evaluates the `WHERE` and applies the decrement as one atomic operation; if two transactions race
for the last units, exactly one `UPDATE` matches the row and decrements it, and the other matches zero rows
and gets `count === 0` — which the code turns into a normal "insufficient stock" error, not a corrupted
negative quantity. `StockService.receive` additionally row-locks the `Product` row (`SELECT … FOR UPDATE`)
before recomputing the moving-average cost, since that calculation reads the current quantity and cost and
writes a new cost derived from both — a genuine read-modify-write that a conditional `UPDATE` alone
wouldn't protect.

## Auth: short-lived access tokens, rotating refresh tokens

Access tokens are JWTs, 15 minutes by default, sent as `Authorization: Bearer` and held only in memory on
the client (never `localStorage`, so they aren't readable by an injected script). The refresh token is an
opaque random value, stored **hashed** in `RefreshToken.tokenHash` (SHA-256; nothing that could
authenticate a session is ever stored in plaintext), delivered as an `httpOnly`, `path=/api/auth` cookie.

Every refresh **rotates**: the old token is marked `revokedAt` and a new one issued, chained via
`replacedById`. If a token already marked revoked is presented again — the signature of a stolen,
previously-used token being replayed — every session for that user is revoked
(`AuthService.refresh`, the reuse-detection branch). A short grace window (30s) absorbs the ordinary case
of two browser tabs refreshing near-simultaneously without treating it as an attack.

An admin-set password (`POST /admin/users`, or a reset) is marked `mustChangePassword: true`; the guard
rejects every route for that user except `/auth/me` and `/auth/change-password` until they set their own
password, which also revokes every other outstanding session for the account.

Optional TOTP two-factor auth (`AuthService.setupTwoFactor`/`enableTwoFactor`/`disableTwoFactor`) adds a
second step without a second table of session state: when a 2FA-enabled account passes the password check,
`login()` returns a `challenge` — a JWT with `purpose: '2fa-login'` and a 5-minute expiry, not a session —
instead of tokens. `POST /auth/2fa/verify-login` trades that challenge plus a 6-digit code (or a one-time
recovery code, hashed the same way as refresh tokens) for the real session. The challenge is stateless and
self-expiring, so there's nothing to revoke or clean up if it's never redeemed.

## Year-end close and the period lock

`CompanySettings.lockDate` is checked by `LedgerService.assertOpenPeriod` on every post and on void —
there's no separate "is this period closed" check scattered through each module. Closing a fiscal year
([`ClosingService.close`](apps/api/src/accounting/closing.ts)) zeroes every income/expense account's
balance for that year into `RETAINED_EARNINGS` with one journal entry tagged `sourceType: CLOSING`, then
sets `lockDate` to the year's end. Reports exclude `CLOSING` entries from the P&L (so a closed year's income
statement still shows what actually happened that year) while including them in the balance sheet (so
retained earnings is correct going forward). Only the most recently closed year can be reopened — closing
out of order, or reopening anything but the latest year, is rejected — so the lock history stays a stack,
never a set with gaps.

## Where the AI copilot's authority ends

[`CopilotTools`](apps/api/src/copilot/copilot.tools.ts) is a fixed list of read-only query functions —
dashboard KPIs, overdue documents, balances, stock levels, trial balance, P&L, leave. None of them call
anything that writes. The model cannot create, post, pay, or delete a record: not because it's told not to
in the system prompt (prompts are not a security boundary), but because the capability simply isn't in the
tool list it's given. Each tool also carries the same `roles` restriction as the matching REST route
(`forRole` mirrors `@Roles()`), so a Sales user's copilot session has access to exactly the tools a Sales
user's UI does — nothing more.

Document extraction (`POST /copilot/extract-bill`) is the one place the copilot's output becomes writes,
and even there it doesn't write directly: it returns a JSON draft that pre-fills the New Bill form, and a
human reviews and submits it through the normal validated `POST /purchasing/bills` path like any other
bill.
