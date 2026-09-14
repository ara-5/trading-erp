/**
 * Populates six months of realistic activity on top of the base seed: sales orders through to paid
 * invoices, purchase orders through to paid bills, stock movements, a few payroll runs, and some leave
 * history. It talks to the running API rather than Prisma directly, so every posting goes through the
 * same validation and ledger rules a real user would hit — the result is guaranteed to reconcile.
 *
 * Run `npm run db:seed` first (creates the chart of accounts, admin user and master data), start the API,
 * then run `npm run db:demo`. Safe to run more than once — it always creates new documents forward from
 * today's data, so re-running just adds more history.
 */
import { PrismaClient } from '@prisma/client';

const API = process.env.DEMO_API_URL ?? 'http://localhost:3001/api';
const prisma = new PrismaClient();

let token: string;
async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data as T;
}
const post = <T = any>(path: string, body: unknown = {}) => call<T>('POST', path, body);
const get = <T = any>(path: string, query?: Record<string, string>) => call<T>('GET', path + (query ? `?${new URLSearchParams(query)}` : ''));

const rand = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
const isoMonthsAgo = (n: number, day: number) => {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  d.setUTCDate(Math.min(day, 28));
  return d.toISOString().slice(0, 10);
};

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@erp.local';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
  const login = await post<{ accessToken: string; user: { mustChangePassword: boolean } }>('/auth/login', { email, password });
  if (login.user.mustChangePassword) {
    throw new Error(
      'The seeded admin account must change its password before it can do anything else. ' +
        'Either log in once through the app and set a new password, or reseed with SEED_FORCE_PASSWORD_CHANGE=false for local/demo use.',
    );
  }
  token = login.accessToken;

  const [products, customers, suppliers, warehouses, accounts, taxRates] = await Promise.all([
    get<{ items: any[] }>('/inventory/products', { pageSize: '50' }).then((r) => r.items.filter((p) => p.isActive)),
    get<{ items: any[] }>('/sales/customers', { pageSize: '50' }).then((r) => r.items),
    get<{ items: any[] }>('/purchasing/suppliers', { pageSize: '50' }).then((r) => r.items),
    get<any[]>('/inventory/warehouses'),
    get<any[]>('/accounting/accounts'),
    get<any[]>('/accounting/tax-rates'),
  ]);
  if (!products.length || !customers.length || !suppliers.length) {
    throw new Error('Run `npm run db:seed` first — no products/customers/suppliers found.');
  }
  const stocked = products.filter((p) => p.trackInventory);
  const services = products.filter((p) => !p.trackInventory);
  const bank = accounts.find((a: any) => a.code === '1020').id;
  const main = warehouses.find((w: any) => w.code === 'MAIN').id;
  const standardTax = taxRates.find((t: any) => t.rate > 0)?.id;

  console.log('Opening capital…');
  const capital = await post('/accounting/journals', {
    date: isoMonthsAgo(6, 1),
    description: 'Owner capital injection',
    lines: [
      { accountId: bank, debit: 100_000 },
      { accountId: accounts.find((a: any) => a.code === '3010').id, credit: 100_000 },
    ],
  });
  await post(`/accounting/journals/${capital.id}/post`);

  console.log('Stocking up warehouses…');
  for (const p of stocked) {
    await post('/inventory/stock/adjust', {
      productId: p.id,
      warehouseId: main,
      quantity: randInt(40, 120),
      unitCost: Number(p.salePrice) * 0.55,
      reason: 'Opening stock',
    });
  }

  console.log('Six months of purchasing…');
  for (let m = 6; m >= 1; m--) {
    for (let i = 0; i < randInt(2, 4); i++) {
      const supplier = rand(suppliers);
      const lines = Array.from({ length: randInt(1, 3) }, () => {
        const product = rand(stocked);
        return { productId: product.id, quantity: randInt(10, 40), unitPrice: Number(product.salePrice) * 0.55, taxRate: standardTax ? 15 : 0 };
      });
      const date = isoMonthsAgo(m, randInt(1, 26));
      const po = await post('/purchasing/orders', { supplierId: supplier.id, warehouseId: main, date, lines });
      await post(`/purchasing/orders/${po.id}/approve`);
      await post(`/purchasing/orders/${po.id}/receive`, { date });
      const bill = await post(`/purchasing/orders/${po.id}/bill`, { date });
      await post(`/purchasing/bills/${bill.id}/post`);
      if (Math.random() < 0.8) {
        await post('/accounting/payments', { direction: 'PAID', date, amount: Number(bill.total), accountId: bank, supplierId: supplier.id, purchaseBillId: bill.id });
      }
    }
    // A recurring overhead expense bill each month.
    const rent = await post('/purchasing/bills', {
      supplierId: rand(suppliers).id,
      date: isoMonthsAgo(m, 3),
      lines: [{ accountId: accounts.find((a: any) => a.code === '6100').id, description: 'Office rent', quantity: 1, unitPrice: 1500 }],
    });
    await post(`/purchasing/bills/${rent.id}/post`);
    await post('/accounting/payments', { direction: 'PAID', date: isoMonthsAgo(m, 5), amount: 1500, accountId: bank, supplierId: rand(suppliers).id, purchaseBillId: rent.id }).catch(() => undefined);
  }

  console.log('Six months of sales…');
  for (let m = 6; m >= 0; m--) {
    const orders = m === 0 ? randInt(3, 6) : randInt(8, 16);
    for (let i = 0; i < orders; i++) {
      const customer = rand(customers);
      const lineCount = randInt(1, 3);
      const lines = Array.from({ length: lineCount }, () => {
        const product = Math.random() < 0.75 ? rand(stocked) : rand(services.length ? services : stocked);
        return { productId: product.id, quantity: randInt(1, 6), discountPct: Math.random() < 0.2 ? 5 : 0 };
      });
      const date = m === 0 ? daysAgo(randInt(0, 6)) : isoMonthsAgo(m, randInt(1, 27));
      const order = await post('/sales/orders', { customerId: customer.id, warehouseId: main, date, lines }).catch(() => null);
      if (!order) continue;
      const confirmed = await post(`/sales/orders/${order.id}/confirm`).catch(() => null);
      if (!confirmed) continue;
      await post(`/sales/orders/${order.id}/deliver`, { date });
      const invoice = await post(`/sales/orders/${order.id}/invoice`, { date });
      await post(`/sales/invoices/${invoice.id}/post`);
      // Most historical invoices are fully paid; this month has a realistic mix of paid/partial/open.
      const payFraction = m === 0 ? rand([0, 0.4, 1, 1]) : rand([1, 1, 1, 0.9]);
      if (payFraction > 0) {
        const amount = Math.round(Number(invoice.total) * payFraction * 100) / 100;
        await post('/accounting/payments', {
          direction: 'RECEIVED',
          date: m === 0 ? date : isoMonthsAgo(m, randInt(1, 27)),
          amount,
          accountId: bank,
          customerId: customer.id,
          salesInvoiceId: invoice.id,
        }).catch(() => undefined);
      }
    }
  }

  console.log('Leads and a few open quotations…');
  const leadNames = ['Nova Retail Group', 'Bluepeak Logistics', 'Fernbridge Traders', 'Solace Electronics', 'Kestrel Wholesale'];
  for (const name of leadNames) {
    await post('/sales/leads', { name: `${name} — Procurement`, company: name, status: rand(['NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL']), estimatedValue: randInt(2000, 25000) });
  }
  for (let i = 0; i < 3; i++) {
    const customer = rand(customers);
    const product = rand(stocked);
    await post('/sales/quotations', {
      customerId: customer.id,
      date: daysAgo(randInt(0, 10)),
      validUntil: daysAgo(-14),
      lines: [{ productId: product.id, quantity: randInt(5, 20) }],
    }).catch(() => undefined);
  }

  console.log('Payroll and leave…');
  const employees = await get<{ items: any[] }>('/hr/employees', { pageSize: '20' }).then((r) => r.items);
  const leaveTypes = await get<any[]>('/hr/leave-types');
  const paidLeave = leaveTypes.find((t) => t.isPaid && t.daysPerYear > 0);
  for (let m = 3; m >= 0; m--) {
    const start = isoMonthsAgo(m, 1);
    const end = isoMonthsAgo(m - 1, 0);
    const run = await post('/hr/payroll', { periodStart: start, periodEnd: end, payDate: end }).catch(() => null);
    if (!run) continue;
    await post(`/hr/payroll/${run.id}/approve`);
    await post(`/hr/payroll/${run.id}/pay`, { accountId: bank });
  }
  if (paidLeave) {
    for (const e of employees.slice(0, Math.min(3, employees.length))) {
      const start = daysAgo(randInt(20, 40));
      const end = daysAgo(randInt(15, 19));
      await post('/hr/leave', { employeeId: e.id, leaveTypeId: paidLeave.id, startDate: start, endDate: end, reason: 'Annual leave' })
        .then((r) => post(`/hr/leave/${r.id}/approve`))
        .catch(() => undefined);
    }
    const pendingEmployee = rand(employees);
    // daysAgo(-n) is n days in the future — start must be the nearer date, end the later one.
    await post('/hr/leave', { employeeId: pendingEmployee.id, leaveTypeId: paidLeave.id, startDate: daysAgo(-3), endDate: daysAgo(-5), reason: 'Family trip' }).catch((e) =>
      console.warn('  (skipped pending leave request:', e.message, ')'),
    );
  }

  console.log('\nDemo data loaded. Trial balance and dashboard should now show six months of activity.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
