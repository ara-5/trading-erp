import { BadRequestException } from '@nestjs/common';
import { SequenceService } from '../common/common.module';
import { D } from '../common/money';
import { Tx } from '../prisma/prisma.service';
import { LedgerService, naturalBalance } from './ledger.service';

const line = (debit: number, credit: number) => ({ debit: D(debit), credit: D(credit) });

function fakeTx(lockDate: Date | null = null) {
  const create = jest.fn(async (args: { data: unknown }) => args.data);
  const tx = {
    companySettings: { findUnique: jest.fn(async () => ({ lockDate })) },
    systemAccount: { findUnique: jest.fn(async ({ where }: { where: { key: string } }) => ({ accountId: `acc-${where.key}` })) },
    journalEntry: { create },
  };
  return { tx: tx as unknown as Tx, create };
}

describe('LedgerService', () => {
  const sequences = { next: jest.fn(async () => 'JE-00001') } as unknown as SequenceService;
  const ledger = new LedgerService(sequences);

  describe('assertBalanced', () => {
    it('accepts balanced entries', () => {
      expect(() => ledger.assertBalanced([line(100, 0), line(0, 60), line(0, 40)])).not.toThrow();
    });

    it.each([
      ['unbalanced', [line(100, 0), line(0, 99.99)], /unbalanced/],
      ['single line', [line(0, 0)], /at least two lines/],
      ['zero total', [line(0, 0), line(0, 0)], /cannot be zero/],
      ['debit and credit on one line', [line(10, 10), line(0, 0)], /both a debit and a credit/],
      ['negative amounts', [line(-5, 0), line(0, -5)], /negative/],
    ])('rejects %s', (_label, lines, message) => {
      expect(() => ledger.assertBalanced(lines)).toThrow(message);
    });
  });

  it('computes balances in each account type’s normal direction', () => {
    expect(naturalBalance('ASSET', D(100), D(30)).toNumber()).toBe(70);
    expect(naturalBalance('EXPENSE', D(100), D(30)).toNumber()).toBe(70);
    expect(naturalBalance('LIABILITY', D(100), D(30)).toNumber()).toBe(-70);
    expect(naturalBalance('INCOME', D(0), D(250)).toNumber()).toBe(250);
  });

  describe('post', () => {
    it('resolves system accounts, drops zero lines and posts immediately', async () => {
      const { tx, create } = fakeTx();
      await ledger.post(tx, {
        date: new Date('2026-09-14'),
        description: 'Invoice',
        sourceType: 'SALES_INVOICE',
        lines: [
          { key: 'ACCOUNTS_RECEIVABLE', debit: 115 },
          { key: 'SALES_REVENUE', credit: 100 },
          { key: 'TAX_PAYABLE', credit: 15 },
          { key: 'TAX_RECEIVABLE', debit: 0 },
        ],
      });
      const data = create.mock.calls[0][0].data as { status: string; number: string; lines: { create: { accountId: string }[] } };
      expect(data.status).toBe('POSTED');
      expect(data.number).toBe('JE-00001');
      expect(data.lines.create.map((l) => l.accountId)).toEqual(['acc-ACCOUNTS_RECEIVABLE', 'acc-SALES_REVENUE', 'acc-TAX_PAYABLE']);
    });

    it('rounds to cents before checking balance', async () => {
      const { tx } = fakeTx();
      await expect(
        ledger.post(tx, { date: new Date(), description: 'x', sourceType: 'MANUAL', lines: [{ accountId: 'a', debit: 10.004 }, { accountId: 'b', credit: 10 }] }),
      ).resolves.toBeDefined();
    });

    it('refuses postings dated inside the locked period', async () => {
      const { tx, create } = fakeTx(new Date('2025-12-31T00:00:00Z'));
      const attempt = (date: string) =>
        ledger.post(tx, { date: new Date(date), description: 'x', sourceType: 'MANUAL', lines: [{ accountId: 'a', debit: 1 }, { accountId: 'b', credit: 1 }] });
      await expect(attempt('2025-12-31T18:00:00Z')).rejects.toThrow(BadRequestException);
      await expect(attempt('2026-01-01')).resolves.toBeDefined();
      expect(create).toHaveBeenCalledTimes(1);
    });
  });
});
