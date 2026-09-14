'use client';

import {
  BarChart3,
  Boxes,
  BookOpen,
  Building2,
  CalendarCheck,
  CalendarDays,
  ClipboardList,
  CreditCard,
  FileText,
  Handshake,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PackageSearch,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  UserCog,
  Users,
  Wallet,
  Warehouse,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { Role, useAuth } from '@/lib/auth';
import { cn, humanize, setCurrency } from '@/lib/format';
import { useGet } from '@/lib/hooks';

type NavItem = { href: string; label: string; icon: typeof Boxes };
type NavSection = { title: string; roles: Role[]; items: NavItem[] };

const nav: NavSection[] = [
  { title: '', roles: [], items: [{ href: '/', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    title: 'Sales',
    roles: ['SALES', 'ACCOUNTANT'],
    items: [
      { href: '/sales/leads', label: 'Leads', icon: Handshake },
      { href: '/sales/customers', label: 'Customers', icon: Users },
      { href: '/sales/quotations', label: 'Quotations', icon: FileText },
      { href: '/sales/orders', label: 'Sales orders', icon: ShoppingCart },
      { href: '/sales/invoices', label: 'Invoices', icon: Receipt },
    ],
  },
  {
    title: 'Purchasing',
    roles: ['PURCHASING', 'INVENTORY', 'ACCOUNTANT'],
    items: [
      { href: '/purchasing/suppliers', label: 'Suppliers', icon: Building2 },
      { href: '/purchasing/orders', label: 'Purchase orders', icon: ClipboardList },
      { href: '/purchasing/bills', label: 'Bills', icon: ScrollText },
    ],
  },
  {
    title: 'Inventory',
    roles: [],
    items: [
      { href: '/inventory/products', label: 'Products', icon: Package },
      { href: '/inventory/stock', label: 'Stock levels', icon: PackageSearch },
      { href: '/inventory/movements', label: 'Movements', icon: Truck },
      { href: '/inventory/warehouses', label: 'Warehouses', icon: Warehouse },
    ],
  },
  {
    title: 'Accounting',
    roles: ['ACCOUNTANT'],
    items: [
      { href: '/accounting/accounts', label: 'Chart of accounts', icon: BookOpen },
      { href: '/accounting/journals', label: 'Journal entries', icon: ScrollText },
      { href: '/accounting/payments', label: 'Payments', icon: Wallet },
      { href: '/accounting/reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    title: 'HR & Payroll',
    roles: ['HR'],
    items: [
      { href: '/hr/employees', label: 'Employees', icon: Users },
      { href: '/hr/attendance', label: 'Attendance', icon: CalendarCheck },
      { href: '/hr/leave', label: 'Leave', icon: CalendarDays },
      { href: '/hr/payroll', label: 'Payroll', icon: CreditCard },
    ],
  },
  {
    title: 'Administration',
    roles: ['ADMIN'],
    items: [
      { href: '/settings', label: 'Company settings', icon: Settings },
      { href: '/settings/users', label: 'Users', icon: UserCog },
      { href: '/settings/audit-log', label: 'Audit log', icon: ShieldCheck },
    ],
  },
];

export function Shell({ children }: { children: ReactNode }) {
  const { user, hasRole, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const settings = useGet<{ name: string; currency: string }>('/admin/settings');

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (settings.data?.currency) setCurrency(settings.data.currency);
  }, [settings.data?.currency]);

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/'));
  // "/settings" must not stay highlighted on its sub-pages.
  const active = (href: string) => (href === '/settings' ? pathname === href : isActive(href));

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <Boxes className="size-4.5" />
        </div>
        <span className="truncate text-sm font-semibold text-slate-900">{settings.data?.name ?? 'ERP'}</span>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {nav
          .filter((s) => hasRole(...s.roles))
          .map((section) => (
            <div key={section.title || 'main'}>
              {section.title && <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{section.title}</p>}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium',
                        active(item.href) ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                      )}
                    >
                      <item.icon className="size-4 shrink-0" />
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
      <div className="border-t border-slate-200 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
            {user?.name.slice(0, 1).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900">{user?.name}</p>
            <p className="truncate text-xs text-slate-500">{user && humanize(user.role)}</p>
          </div>
          <button onClick={logout} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Sign out" title="Sign out">
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-full">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-slate-200 bg-white lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl">
            <button onClick={() => setOpen(false)} className="absolute right-2 top-3 rounded p-1.5 text-slate-400" aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden">
          <button onClick={() => setOpen(true)} className="rounded p-1.5 text-slate-600" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <span className="text-sm font-semibold">{settings.data?.name ?? 'ERP'}</span>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
