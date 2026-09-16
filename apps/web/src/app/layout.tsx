import type { Metadata } from 'next';
import { ReactNode } from 'react';
import { NO_FLASH_SCRIPT } from '@/lib/theme';
import './globals.css';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'ERP',
  description: 'Accounting, inventory, sales, purchasing and HR in one place',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line react/no-danger */}
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
