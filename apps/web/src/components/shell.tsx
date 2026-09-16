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
  LineChart,
  LogOut,
  Menu,
  Moon,
  Package,
  PackageSearch,
  Receipt,
  ScrollText,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Sun,
  SunMoon,
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
import { CommandPalette } from '@/components/command-palette';
import { Role, useAuth } from '@/lib/auth';
import { cn, humanize, setCurrency } from '@/lib/format';
import { useGet } from '@/lib/hooks';
import { useTheme } from '@/lib/theme';

export type NavItem = { href: string; label: string; icon: typeof Boxes };
export type NavSection = { title: string; roles: Role[]; items: NavItem[] };

export const nav: NavSection[] = [
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
      { href: '/accounting/analytics', label: 'Analytics', icon: LineChart },
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

const THEME_ICONS = { light: Sun, dark: Moon, system: SunMoon } as const;

function ThemeToggle() {
  const { preference, setPreference } = useTheme();
  const order = ['light', 'dark', 'system'] as const;
  const Icon = THEME_ICONS[preference];
  return (
    <button
      onClick={() => setPreference(order[(order.indexOf(preference) + 1) % order.length])}
      className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
      aria-label={`Theme: ${preference} (click to change)`}
      title={`Theme: ${humanize(preference)} — click to change`}
    >
      <Icon className="size-4" />
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { user, hasRole, logout } = useAuth();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const settings = useGet<{ name: string; currency: string }>('/admin/settings');

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (settings.data?.currency) setCurrency(settings.data.currency);
  }, [settings.data?.currency]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(href + '/'));
  // "/settings" must not stay highlighted on its sub-pages.
  const active = (href: string) => (href === '/settings' ? pathname === href : isActive(href));

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex h-14 items-center gap-2 px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-indigo-600 text-white dark:bg-indigo-500">
          <Boxes className="size-4.5" />
        </div>
        <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{settings.data?.name ?? 'ERP'}</span>
      </div>
      <div className="px-3">
        <button
          onClick={() => setPaletteOpen(true)}
          className="flex w-full items-center gap-2 rounded-lg bg-slate-100 px-2.5 py-1.5 text-left text-sm text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
        >
          <Search className="size-3.5" />
          Search…
          <kbd className="ml-auto rounded border border-slate-300 bg-white px-1 font-mono text-[10px] text-slate-400 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-500">
            ⌘K
          </kbd>
        </button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {nav
          .filter((s) => hasRole(...s.roles))
          .map((section) => (
            <div key={section.title || 'main'}>
              {section.title && <p className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">{section.title}</p>}
              <ul className="space-y-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm font-medium',
                        active(item.href)
                          ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
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
      <div className="border-t border-slate-200 p-3 dark:border-slate-800">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
          <Link href="/account" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
              {user?.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{user?.name}</p>
              <p className="truncate text-xs text-slate-500 dark:text-slate-400">{user && humanize(user.role)}</p>
            </div>
          </Link>
          <ThemeToggle />
          <button
            onClick={logout}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </div>
      </div>
    </nav>
  );

  return (
    <div className="min-h-full">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-slate-200 bg-white lg:block dark:border-slate-800 dark:bg-slate-900">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-white shadow-xl dark:bg-slate-900">
            <button onClick={() => setOpen(false)} className="absolute right-2 top-3 rounded p-1.5 text-slate-400" aria-label="Close menu">
              <X className="size-5" />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden dark:border-slate-800 dark:bg-slate-900/90">
          <button onClick={() => setOpen(true)} className="rounded p-1.5 text-slate-600 dark:text-slate-300" aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{settings.data?.name ?? 'ERP'}</span>
          <button onClick={() => setPaletteOpen(true)} className="ml-auto rounded p-1.5 text-slate-600 dark:text-slate-300" aria-label="Search">
            <Search className="size-4.5" />
          </button>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
