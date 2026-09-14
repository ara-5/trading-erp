/* eslint-disable @typescript-eslint/no-explicit-any */
import { NestExpressApplication } from '@nestjs/platform-express';
import { accountsByCode, ADMIN, Client, createApp, loginAs, today, uid } from './helpers';

/**
 * Walks the core business cycles end to end and checks the accounting invariants that tie them together:
 * the trial balance balances, the balance sheet balances, GRNI clears, and GL inventory equals the stock valuation.
 */
describe('Business flows (e2e)', () => {
  let app: NestExpressApplication;
  let api: Client;
  let acc: (code: string) => string;
  let laptop: any;
  let service: any;
  let customer: any;
  let supplier: any;
  let main: any;
  let store: any;
  let invoiceId: string;

  beforeAll(async () => {
    app = await createApp();
    api = await loginAs(app, ADMIN.email, ADMIN.password);
    acc = await accountsByCode(api);
    const taxRates = await api.get('/accounting/tax-rates');
    const standard = taxRates.find((t: any) => t.name === 'Standard 15%');
    const suffix = uid();
    laptop = await api.post('/inventory/products', { sku: `LAP-${suffix}`, name: 'Test Laptop', salePrice: 899, taxRateId: standard.id, reorderLevel: 2 });
    service = await api.post('/inventory/products', { sku: `SRV-${suffix}`, name: 'Setup service', salePrice: 50, trackInventory: false, taxRateId: standard.id });
    customer = await api.post('/sales/customers', { name: `Flow Customer ${suffix}`, creditLimit: 10_000 });
    supplier = await api.post('/purchasing/suppliers', { name: `Flow Supplier ${suffix}` });
    const warehouses = await api.get('/inventory/warehouses');
    main = warehouses.find((w: any) => w.code === 'MAIN');
    store = warehouses.find((w: any) => w.code === 'STORE');
  });
  afterAll(() => app.close());

  const onHand = async () => Number((await api.get(`/inventory/products/${laptop.id}`)).onHand);

  it('posts a balanced manual journal and rejects malformed ones', async () => {
    const je = await api.post('/accounting/journals', {
      date: today(),
      description: 'Owner capital',
      lines: [
        { accountId: acc('1020'), debit: 50_000 },
        { accountId: acc('3010'), credit: 50_000 },
      ],
    });
    expect((await api.post(`/accounting/journals/${je.id}/post`)).status).toBe('POSTED');

    const bothSides = { date: today(), description: 'bad', lines: [{ accountId: acc('1020'), debit: 5, credit: 5 }, { accountId: acc('3010'), credit: 5 }] };
    expect(await api.fails('post', '/accounting/journals', bothSides, 400)).toMatch(/both a debit and a credit/);

    const unbalanced = await api.post('/accounting/journals', { date: today(), description: 'unbalanced', lines: [{ accountId: acc('1020'), debit: 10 }, { accountId: acc('3010'), credit: 9 }] });
    expect(await api.fails('post', `/accounting/journals/${unbalanced.id}/post`, {}, 400)).toMatch(/unbalanced/);
  });

  it('purchases: PO → partial receipts at weighted-average cost → bill → payment', async () => {
    const po = await api.post('/purchasing/orders', { supplierId: supplier.id, warehouseId: main.id, date: today(), lines: [{ productId: laptop.id, quantity: 10, unitPrice: 600, taxRate: 15 }] });
    await api.post(`/purchasing/orders/${po.id}/approve`);
    const full = await api.get(`/purchasing/orders/${po.id}`);

    // First receipt at PO price; then an adjustment-in at a different cost moves the average.
    await api.post(`/purchasing/orders/${po.id}/receive`, { lines: [{ lineId: full.lines[0].id, quantity: 6 }] });
    expect((await api.get(`/purchasing/orders/${po.id}`)).status).toBe('PARTIALLY_RECEIVED');
    await api.post(`/purchasing/orders/${po.id}/receive`, {});
    expect(await onHand()).toBe(10);
    expect(Number((await api.get(`/inventory/products/${laptop.id}`)).costPrice)).toBe(600);

    const bill = await api.post(`/purchasing/orders/${po.id}/bill`, {});
    expect(Number(bill.total)).toBe(6900);
    await api.post(`/purchasing/bills/${bill.id}/post`);
    expect(await api.fails('post', `/purchasing/orders/${po.id}/bill`, {}, 400)).toMatch(/no received, unbilled/);

    await api.post('/accounting/payments', { direction: 'PAID', date: today(), amount: 6900, accountId: acc('1020'), supplierId: supplier.id, purchaseBillId: bill.id });
    expect((await api.get(`/purchasing/bills/${bill.id}`)).status).toBe('PAID');

    const expense = await api.post('/purchasing/bills', { supplierId: supplier.id, date: today(), lines: [{ accountId: acc('6100'), description: 'Office rent', quantity: 1, unitPrice: 1200 }] });
    expect((await api.post(`/purchasing/bills/${expense.id}/post`)).status).toBe('POSTED');
  });

  it('sales: quotation → order → delivery → invoice → part payment', async () => {
    const quote = await api.post('/sales/quotations', { customerId: customer.id, date: today(), lines: [{ productId: laptop.id, quantity: 4, discountPct: 5 }, { productId: service.id, quantity: 3 }] });
    await api.post(`/sales/quotations/${quote.id}/accept`);
    const order = await api.post(`/sales/quotations/${quote.id}/convert`, { warehouseId: main.id });
    await api.post(`/sales/orders/${order.id}/confirm`);
    await api.post(`/sales/orders/${order.id}/deliver`, {});
    expect(await onHand()).toBe(6);

    const invoice = await api.post(`/sales/orders/${order.id}/invoice`, {});
    invoiceId = invoice.id;
    // Laptops 4 × 899 × 0.95 = 3416.20 (+15% 512.43); service 3 × 50 = 150 (+15% 22.50)
    expect(Number(invoice.subtotal)).toBe(3566.2);
    expect(Number(invoice.total)).toBe(4101.13);
    await api.post(`/sales/invoices/${invoice.id}/post`);
    expect(await api.fails('post', `/sales/orders/${order.id}/invoice`, {}, 400)).toMatch(/Nothing to invoice/);

    await api.post('/accounting/payments', { direction: 'RECEIVED', date: today(), amount: 2000, accountId: acc('1020'), customerId: customer.id, salesInvoiceId: invoice.id });
    expect((await api.get(`/sales/invoices/${invoice.id}`)).status).toBe('PARTIALLY_PAID');
    const overpay = { direction: 'RECEIVED', date: today(), amount: 99_999, accountId: acc('1020'), customerId: customer.id, salesInvoiceId: invoice.id };
    expect(await api.fails('post', '/accounting/payments', overpay, 400)).toMatch(/exceeds the outstanding/);
  });

  it('enforces credit limits and order-only invoicing of stock items', async () => {
    const big = await api.post('/sales/orders', { customerId: customer.id, warehouseId: main.id, date: today(), lines: [{ productId: laptop.id, quantity: 100 }] });
    expect(await api.fails('post', `/sales/orders/${big.id}/confirm`, {}, 400)).toMatch(/Credit limit exceeded/);
    const direct = { customerId: customer.id, date: today(), lines: [{ productId: laptop.id, quantity: 1 }] };
    expect(await api.fails('post', '/sales/invoices', direct, 400)).toMatch(/sales order/);
  });

  it('transfers and adjusts stock with availability checks', async () => {
    await api.post('/inventory/stock/transfer', { productId: laptop.id, fromWarehouseId: main.id, toWarehouseId: store.id, quantity: 2 });
    const tooMuch = { productId: laptop.id, fromWarehouseId: store.id, toWarehouseId: main.id, quantity: 50 };
    expect(await api.fails('post', '/inventory/stock/transfer', tooMuch, 400)).toMatch(/Insufficient stock/);
    await api.post('/inventory/stock/adjust', { productId: laptop.id, warehouseId: main.id, quantity: -1, reason: 'Damaged' });
    expect(await onHand()).toBe(5);
    const low = await api.get('/inventory/stock/low');
    expect(low.some((p: any) => p.id === laptop.id)).toBe(false);
  });

  it('runs payroll with unpaid-leave deductions through approval and payment', async () => {
    const employees = (await api.get('/hr/employees')).items;
    const unpaid = (await api.get('/hr/leave-types')).find((t: any) => t.name === 'Unpaid Leave');
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    const fifth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5)).toISOString().slice(0, 10);

    const leave = await api.post('/hr/leave', { employeeId: employees[0].id, leaveTypeId: unpaid.id, startDate: start, endDate: fifth });
    await api.post(`/hr/leave/${leave.id}/approve`);
    expect(await api.fails('post', '/hr/leave', { employeeId: employees[0].id, leaveTypeId: unpaid.id, startDate: start, endDate: start }, 400)).toMatch(/overlaps/);

    const run = await api.post('/hr/payroll', { periodStart: start, periodEnd: end, payDate: end });
    const detail = await api.get(`/hr/payroll/${run.id}`);
    expect(detail.payslips).toHaveLength(employees.length);
    const slip = detail.payslips.find((p: any) => p.employee.id === employees[0].id);
    expect(Number(slip.unpaidLeaveDeduction)).toBeGreaterThan(0);

    await api.patch(`/hr/payroll/${run.id}/payslips/${slip.id}`, { overtime: 250, otherDeductions: 100 });
    const updated = (await api.get(`/hr/payroll/${run.id}`)).payslips.find((p: any) => p.id === slip.id);
    expect(Number(updated.netPay)).toBeCloseTo(Number(updated.grossPay) - Number(updated.taxAmount) - 100, 2);

    await api.post(`/hr/payroll/${run.id}/approve`);
    await api.post(`/hr/payroll/${run.id}/pay`, { accountId: acc('1020') });
    expect((await api.get(`/hr/payroll/${run.id}`)).status).toBe('PAID');
  });

  it('keeps the ledger balanced and inventory reconciled to the GL', async () => {
    const tb = await api.get('/accounting/reports/trial-balance');
    expect(Number(tb.totalDebit)).toBeCloseTo(Number(tb.totalCredit), 2);

    const bs = await api.get('/accounting/reports/balance-sheet');
    expect(bs.balanced).toBe(true);

    expect(tb.rows.find((r: any) => r.code === '2050')).toBeUndefined();
    const glInventory = Number(tb.rows.find((r: any) => r.code === '1200')?.debit ?? 0);
    expect(glInventory).toBeCloseTo(Number((await api.get('/inventory/stock/valuation')).total), 2);

    const aging = await api.get('/accounting/reports/aging/receivables');
    expect(Number(aging.rows.find((r: any) => r.partyId === customer.id).total)).toBeCloseTo(2101.13, 2);
    expect((await api.get(`/sales/invoices/${invoiceId}`)).customer.id).toBe(customer.id);
  });
});
