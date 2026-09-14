import { AccountType, PrismaClient, Role, SystemAccountKey } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const accounts: [code: string, name: string, type: AccountType, parent?: string][] = [
  ['1000', 'Assets', 'ASSET'],
  ['1010', 'Cash on Hand', 'ASSET', '1000'],
  ['1020', 'Bank Account', 'ASSET', '1000'],
  ['1100', 'Accounts Receivable', 'ASSET', '1000'],
  ['1200', 'Inventory', 'ASSET', '1000'],
  ['1300', 'Input Tax Receivable', 'ASSET', '1000'],
  ['1500', 'Fixed Assets', 'ASSET', '1000'],
  ['2000', 'Liabilities', 'LIABILITY'],
  ['2010', 'Accounts Payable', 'LIABILITY', '2000'],
  ['2050', 'Goods Received Not Billed', 'LIABILITY', '2000'],
  ['2100', 'Output Tax Payable', 'LIABILITY', '2000'],
  ['2200', 'Salaries Payable', 'LIABILITY', '2000'],
  ['2210', 'Payroll Withholdings Payable', 'LIABILITY', '2000'],
  ['3000', 'Equity', 'EQUITY'],
  ['3010', "Owner's Capital", 'EQUITY', '3000'],
  ['3100', 'Retained Earnings', 'EQUITY', '3000'],
  ['4000', 'Income', 'INCOME'],
  ['4010', 'Sales Revenue', 'INCOME', '4000'],
  ['4900', 'Other Income', 'INCOME', '4000'],
  ['5000', 'Cost of Sales', 'EXPENSE'],
  ['5010', 'Cost of Goods Sold', 'EXPENSE', '5000'],
  ['5020', 'Inventory Adjustments & Variances', 'EXPENSE', '5000'],
  ['6000', 'Operating Expenses', 'EXPENSE'],
  ['6010', 'Salaries & Wages', 'EXPENSE', '6000'],
  ['6100', 'Rent', 'EXPENSE', '6000'],
  ['6200', 'Utilities', 'EXPENSE', '6000'],
  ['6300', 'Office Supplies', 'EXPENSE', '6000'],
  ['6400', 'Shipping & Freight', 'EXPENSE', '6000'],
  ['6900', 'General Expenses', 'EXPENSE', '6000'],
];

const systemAccounts: Record<SystemAccountKey, string> = {
  CASH: '1010',
  BANK: '1020',
  ACCOUNTS_RECEIVABLE: '1100',
  INVENTORY: '1200',
  TAX_RECEIVABLE: '1300',
  ACCOUNTS_PAYABLE: '2010',
  GOODS_RECEIVED_NOT_BILLED: '2050',
  TAX_PAYABLE: '2100',
  SALARY_PAYABLE: '2200',
  PAYROLL_TAX_PAYABLE: '2210',
  RETAINED_EARNINGS: '3100',
  SALES_REVENUE: '4010',
  COST_OF_GOODS_SOLD: '5010',
  INVENTORY_ADJUSTMENT: '5020',
  SALARY_EXPENSE: '6010',
};

const sequences: [key: string, prefix: string][] = [
  ['JE', 'JE-'],
  ['QT', 'QT-'],
  ['SO', 'SO-'],
  ['INV', 'INV-'],
  ['PO', 'PO-'],
  ['BILL', 'BILL-'],
  ['RCPT', 'RCPT-'],
  ['PAY', 'PAY-'],
  ['PR', 'PR-'],
  ['CUST', 'C'],
  ['SUP', 'S'],
  ['EMP', 'E'],
];

async function main() {
  await prisma.companySettings.upsert({
    where: { id: 1 },
    create: { id: 1, name: 'Demo Trading Co.', currency: 'USD', email: 'info@demo-trading.local' },
    update: {},
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@erp.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin@12345';
  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      name: 'Administrator',
      role: Role.ADMIN,
      passwordHash: await bcrypt.hash(adminPassword, 10),
      // The default password is public (it's in the README), so force a change on first login.
      mustChangePassword: process.env.SEED_FORCE_PASSWORD_CHANGE !== 'false',
    },
    update: {},
  });

  for (const [key, prefix] of sequences) {
    await prisma.numberSequence.upsert({ where: { key }, create: { key, prefix }, update: {} });
  }

  const idByCode = new Map<string, string>();
  for (const [code, name, type, parent] of accounts) {
    const acc = await prisma.account.upsert({
      where: { code },
      create: { code, name, type, parentId: parent ? idByCode.get(parent) : undefined },
      update: {},
    });
    idByCode.set(code, acc.id);
  }
  for (const [key, code] of Object.entries(systemAccounts)) {
    await prisma.systemAccount.upsert({
      where: { key: key as SystemAccountKey },
      create: { key: key as SystemAccountKey, accountId: idByCode.get(code)! },
      update: {},
    });
  }

  const standard = await prisma.taxRate.upsert({ where: { name: 'Standard 15%' }, create: { name: 'Standard 15%', rate: 15 }, update: {} });
  await prisma.taxRate.upsert({ where: { name: 'Zero rated' }, create: { name: 'Zero rated', rate: 0 }, update: {} });

  await prisma.warehouse.upsert({ where: { code: 'MAIN' }, create: { code: 'MAIN', name: 'Main Warehouse' }, update: {} });
  await prisma.warehouse.upsert({ where: { code: 'STORE' }, create: { code: 'STORE', name: 'Retail Store' }, update: {} });

  const electronics = await prisma.productCategory.upsert({ where: { name: 'Electronics' }, create: { name: 'Electronics' }, update: {} });
  const accessories = await prisma.productCategory.upsert({ where: { name: 'Accessories' }, create: { name: 'Accessories' }, update: {} });
  const services = await prisma.productCategory.upsert({ where: { name: 'Services' }, create: { name: 'Services' }, update: {} });

  const products = [
    { sku: 'LAP-14', name: 'Laptop 14"', categoryId: electronics.id, salePrice: 899, reorderLevel: 5 },
    { sku: 'MON-27', name: 'Monitor 27" QHD', categoryId: electronics.id, salePrice: 259, reorderLevel: 8 },
    { sku: 'KBD-MX', name: 'Mechanical Keyboard', categoryId: accessories.id, salePrice: 79, reorderLevel: 15 },
    { sku: 'MSE-WL', name: 'Wireless Mouse', categoryId: accessories.id, salePrice: 25, reorderLevel: 25 },
    { sku: 'SRV-SETUP', name: 'On-site Setup Service', categoryId: services.id, salePrice: 50, trackInventory: false, uom: 'hr' },
  ];
  for (const p of products) {
    await prisma.product.upsert({ where: { sku: p.sku }, create: { ...p, taxRateId: standard.id }, update: {} });
  }

  const customers = [
    { code: 'C00001', name: 'Acme Corporation', email: 'ap@acme.example', creditLimit: 50000 },
    { code: 'C00002', name: 'Globex Ltd', email: 'finance@globex.example', paymentTermsDays: 15 },
  ];
  for (const c of customers) await prisma.customer.upsert({ where: { code: c.code }, create: c, update: {} });

  const suppliers = [
    { code: 'S00001', name: 'TechSource Distribution', email: 'orders@techsource.example' },
    { code: 'S00002', name: 'Office Wholesale Co', email: 'sales@officewholesale.example', paymentTermsDays: 45 },
  ];
  for (const s of suppliers) await prisma.supplier.upsert({ where: { code: s.code }, create: s, update: {} });

  // Keep auto-generated codes from colliding with the seeded ones.
  await prisma.numberSequence.update({ where: { key: 'CUST' }, data: { next: { set: 3 } } }).catch(() => undefined);
  await prisma.numberSequence.update({ where: { key: 'SUP' }, data: { next: { set: 3 } } }).catch(() => undefined);

  const departments = ['Management', 'Sales', 'Warehouse', 'Finance'];
  const deptId = new Map<string, string>();
  for (const name of departments) {
    const d = await prisma.department.upsert({ where: { name }, create: { name }, update: {} });
    deptId.set(name, d.id);
  }

  const employees = [
    { code: 'E00001', firstName: 'Sam', lastName: 'Rivera', jobTitle: 'General Manager', dept: 'Management', baseSalary: 7500, taxRatePct: 20 },
    { code: 'E00002', firstName: 'Jordan', lastName: 'Lee', jobTitle: 'Sales Executive', dept: 'Sales', baseSalary: 4200, allowances: 300, taxRatePct: 15 },
    { code: 'E00003', firstName: 'Alex', lastName: 'Kim', jobTitle: 'Warehouse Lead', dept: 'Warehouse', baseSalary: 3600, taxRatePct: 12 },
    { code: 'E00004', firstName: 'Taylor', lastName: 'Morgan', jobTitle: 'Accountant', dept: 'Finance', baseSalary: 4800, taxRatePct: 15 },
  ];
  for (const { dept, ...e } of employees) {
    await prisma.employee.upsert({
      where: { code: e.code },
      create: { ...e, departmentId: deptId.get(dept), hireDate: new Date('2024-01-15') },
      update: {},
    });
  }
  await prisma.numberSequence.update({ where: { key: 'EMP' }, data: { next: { set: 5 } } }).catch(() => undefined);

  for (const lt of [
    { name: 'Annual Leave', daysPerYear: 21, isPaid: true },
    { name: 'Sick Leave', daysPerYear: 10, isPaid: true },
    { name: 'Unpaid Leave', daysPerYear: 0, isPaid: false },
  ]) {
    await prisma.leaveType.upsert({ where: { name: lt.name }, create: lt, update: {} });
  }

  console.log(`Seed complete. Log in with ${adminEmail} / ${adminPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
