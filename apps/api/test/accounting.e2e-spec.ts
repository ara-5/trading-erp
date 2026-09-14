/* eslint-disable @typescript-eslint/no-explicit-any */
import { NestExpressApplication } from '@nestjs/platform-express';
import { createOpenApiDocument } from '../src/common/swagger';
import { accountsByCode, ADMIN, binary, Client, createApp, loginAs, today, uid } from './helpers';

describe('Accounting controls (e2e)', () => {
  let app: NestExpressApplication;
  let api: Client;
  let acc: (code: string) => string;
  let customer: any;
  let service: any;

  const invoice = async (amount: number) => {
    const inv = await api.post('/sales/invoices', { customerId: customer.id, date: today(), lines: [{ productId: service.id, quantity: 1, unitPrice: amount, taxRate: 0 }] });
    return api.post(`/sales/invoices/${inv.id}/post`);
  };
  const receive = (inv: any, amount: number) =>
    api.post('/accounting/payments', { direction: 'RECEIVED', date: today(), amount, accountId: acc('1020'), customerId: customer.id, salesInvoiceId: inv.id });

  beforeAll(async () => {
    app = await createApp();
    api = await loginAs(app, ADMIN.email, ADMIN.password);
    acc = await accountsByCode(api);
    customer = await api.post('/sales/customers', { name: `Controls Customer ${uid()}` });
    service = await api.post('/inventory/products', { sku: `CONSULT-${uid()}`, name: 'Consulting', salePrice: 100, trackInventory: false });
  });
  afterAll(() => app.close());

  it('voids a payment, reopening the invoice and voiding its journal entry', async () => {
    const inv = await invoice(237.5);
    const payment = await receive(inv, 237.5);
    expect((await api.get(`/sales/invoices/${inv.id}`)).status).toBe('PAID');

    const voided = await api.post(`/accounting/payments/${payment.id}/void`, { reason: 'Cheque bounced' });
    expect(voided.voidedAt).toBeTruthy();
    const reopened = await api.get(`/sales/invoices/${inv.id}`);
    expect(reopened.status).toBe('POSTED');
    expect(Number(reopened.amountPaid)).toBe(0);
    expect((await api.get(`/accounting/journals/${payment.journalEntryId}`)).status).toBe('VOID');
    expect(await api.fails('post', `/accounting/payments/${payment.id}/void`, { reason: 'again' }, 400)).toMatch(/already voided/);
  });

  it('reconciles a bank statement: auto-match, fee entry, manual match and guards', async () => {
    const inv = await invoice(313.37);
    const payment = await receive(inv, 313.37);
    const bank = acc('1020');

    const imported = await api.post(`/accounting/bank/${bank}/import`, {
      lines: [
        { date: today(), description: `Transfer ${inv.number}`, amount: 313.37 },
        { date: today(), description: 'Monthly account fee', amount: -12.5 },
        { date: today(), description: `Transfer ${inv.number}`, amount: 313.37 }, // duplicate row in the same file
      ],
    });
    expect(imported).toMatchObject({ imported: 2, skipped: 1, matched: 1 });

    const unmatched = (await api.get(`/accounting/bank/${bank}/statement`, { status: 'UNMATCHED' })).items;
    const fee = unmatched.find((l: any) => l.description === 'Monthly account fee');
    expect(fee).toBeDefined();
    const matchedFee = await api.post(`/accounting/bank/lines/${fee.id}/create-entry`, { accountId: acc('6900'), description: 'Bank charges' });
    expect(matchedFee.status).toBe('MATCHED');

    const receiptLine = (await api.get(`/accounting/bank/${bank}/statement`, { search: inv.number })).items[0];
    expect(receiptLine.status).toBe('MATCHED');
    expect(await api.fails('post', `/accounting/payments/${payment.id}/void`, { reason: 'x' }, 400)).toMatch(/reconciled/);

    // Unmatch, then match by hand against the payment's bank line.
    await api.post(`/accounting/bank/lines/${receiptLine.id}/unmatch`);
    const bookLines = await api.get(`/accounting/bank/${bank}/unreconciled`);
    const bookLine = bookLines.find((l: any) => l.entry.id === payment.journalEntryId);
    const wrongAmount = bookLines.find((l: any) => Number(l.debit) - Number(l.credit) !== 313.37);
    if (wrongAmount) expect(await api.fails('post', `/accounting/bank/lines/${receiptLine.id}/match`, { journalLineId: wrongAmount.id }, 400)).toMatch(/do not match/);
    expect((await api.post(`/accounting/bank/lines/${receiptLine.id}/match`, { journalLineId: bookLine.id })).status).toBe('MATCHED');

    const summary = await api.get(`/accounting/bank/${bank}/summary`);
    expect(summary.unmatchedStatementLines).toBe(0);
    expect(Number(summary.statementBalance)).toBeCloseTo(300.87, 2);
  });

  it('closes a fiscal year into retained earnings, locks the period and can reopen it', async () => {
    const lastYear = new Date().getUTCFullYear() - 1;
    const je = await api.post('/accounting/journals', {
      date: `${lastYear}-06-30`,
      description: 'Prior-year activity',
      lines: [
        { accountId: acc('1010'), debit: 1000 },
        { accountId: acc('4900'), credit: 1000 },
        { accountId: acc('6200'), debit: 400 },
        { accountId: acc('1010'), credit: 400 },
      ],
    });
    await api.post(`/accounting/journals/${je.id}/post`);

    const overview = await api.get('/accounting/year-end');
    expect(overview.next).toMatchObject({ year: lastYear, canClose: true });
    expect(await api.fails('post', '/accounting/year-end/close', { year: lastYear + 1 }, 400)).toMatch(/not ended yet/);

    const closed = await api.post('/accounting/year-end/close', { year: lastYear });
    expect(Number(closed.netIncome)).toBe(600);
    expect(await api.fails('post', '/accounting/year-end/close', { year: lastYear }, 400)).toMatch(/already closed/);

    // P&L for the closed year still shows the activity (closing entry excluded)…
    const pl = await api.get('/accounting/reports/profit-loss', { from: `${lastYear}-01-01`, to: `${lastYear}-12-31` });
    expect(Number(pl.netProfit)).toBe(600);
    // …while the balance sheet carries it in retained earnings.
    const bs = await api.get('/accounting/reports/balance-sheet', { asOf: `${lastYear}-12-31` });
    expect(Number(bs.equity.find((r: any) => r.code === '3100').balance)).toBe(600);
    expect(Number(bs.currentEarnings)).toBe(0);
    expect(bs.balanced).toBe(true);

    // Nothing can be posted into the locked period.
    const late = await api.post('/accounting/journals', {
      date: `${lastYear}-12-15`,
      description: 'Late adjustment',
      lines: [
        { accountId: acc('6200'), debit: 50 },
        { accountId: acc('1010'), credit: 50 },
      ],
    });
    expect(await api.fails('post', `/accounting/journals/${late.id}/post`, {}, 400)).toMatch(/locked through/);
    expect(await api.fails('post', `/accounting/journals/${je.id}/void`, {}, 400)).toMatch(/locked through/);

    const reopened = await api.post('/accounting/year-end/reopen', { year: lastYear });
    expect(reopened.lockDate).toBeNull();
    expect((await api.post(`/accounting/journals/${late.id}/post`)).status).toBe('POSTED');
  });

  it('renders invoice, quotation, purchase order and payslip PDFs', async () => {
    const pdf = async (path: string) => {
      const res = await api.raw('get', path).buffer(true).parse(binary);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    };
    const inv = await invoice(99);
    await pdf(`/sales/invoices/${inv.id}/pdf`);

    const quote = await api.post('/sales/quotations', { customerId: customer.id, date: today(), lines: [{ productId: service.id, quantity: 2 }] });
    await pdf(`/sales/quotations/${quote.id}/pdf`);

    const supplier = await api.post('/purchasing/suppliers', { name: `PDF Supplier ${uid()}` });
    const warehouse = (await api.get('/inventory/warehouses'))[0];
    const po = await api.post('/purchasing/orders', { supplierId: supplier.id, warehouseId: warehouse.id, date: today(), lines: [{ productId: service.id, quantity: 1, unitPrice: 10 }] });
    await pdf(`/purchasing/orders/${po.id}/pdf`);

    const month = new Date();
    const start = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 3, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() - 2, 0)).toISOString().slice(0, 10);
    const run = await api.post('/hr/payroll', { periodStart: start, periodEnd: end, payDate: end });
    const slip = (await api.get(`/hr/payroll/${run.id}`)).payslips[0];
    await pdf(`/hr/payroll/${run.id}/payslips/${slip.id}/pdf`);
  });

  it('documents routes with request schemas derived from the Zod validators', () => {
    const doc = createOpenApiDocument(app) as any;
    const createInvoice = doc.paths['/api/sales/invoices'].post;
    expect(createInvoice.tags).toEqual(['Sales']);
    expect(createInvoice.requestBody.content['application/json'].schema.properties.lines.type).toBe('array');
    expect(doc.paths['/api/auth/login'].post.security).toEqual([]);
    const listParams = doc.paths['/api/sales/invoices'].get.parameters.map((p: any) => p.name);
    expect(listParams).toEqual(expect.arrayContaining(['page', 'pageSize', 'search', 'status', 'customerId']));
    expect(doc.paths['/api/accounting/bank/{accountId}/import'].post.requestBody).toBeDefined();
  });
});
