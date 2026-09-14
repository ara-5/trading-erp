import { BadRequestException, Injectable } from '@nestjs/common';
import { AccountType, SourceType, SystemAccountKey } from '@prisma/client';
import { SequenceService } from '../common/common.module';
import { D, Decimal, round2, ZERO } from '../common/money';
import { Tx } from '../prisma/prisma.service';

/** Balance expressed in the account's normal direction (debit-normal for assets/expenses). */
export function naturalBalance(type: AccountType, debit: Decimal, credit: Decimal): Decimal {
  return type === 'ASSET' || type === 'EXPENSE' ? debit.minus(credit) : credit.minus(debit);
}

export interface PostingLine {
  /** Either a concrete account id or a system account role. */
  accountId?: string;
  key?: SystemAccountKey;
  debit?: Decimal | number;
  credit?: Decimal | number;
  description?: string;
}

export interface PostingInput {
  date: Date;
  description: string;
  reference?: string;
  sourceType: SourceType;
  sourceId?: string;
  lines: PostingLine[];
}

/**
 * The single entry point for writing to the general ledger.
 * Every automatic posting (invoices, bills, payments, stock, payroll) goes through here,
 * which guarantees each entry balances before it is persisted.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly sequences: SequenceService) {}

  async resolveKey(tx: Tx, key: SystemAccountKey): Promise<string> {
    const row = await tx.systemAccount.findUnique({ where: { key } });
    if (!row) throw new BadRequestException(`System account ${key} is not configured (Settings → System accounts)`);
    return row.accountId;
  }

  async post(tx: Tx, input: PostingInput) {
    const lines = await Promise.all(
      input.lines
        .map((l) => ({ ...l, debit: round2(D(l.debit)), credit: round2(D(l.credit)) }))
        .filter((l) => !l.debit.isZero() || !l.credit.isZero())
        .map(async (l) => ({
          accountId: l.accountId ?? (await this.resolveKey(tx, l.key!)),
          debit: l.debit,
          credit: l.credit,
          description: l.description,
        })),
    );
    this.assertBalanced(lines);

    return tx.journalEntry.create({
      data: {
        number: await this.sequences.next(tx, 'JE'),
        date: input.date,
        description: input.description,
        reference: input.reference,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        status: 'POSTED',
        postedAt: new Date(),
        lines: { create: lines },
      },
    });
  }

  assertBalanced(lines: { debit: Decimal; credit: Decimal }[]) {
    if (lines.length < 2) throw new BadRequestException('A journal entry needs at least two lines');
    for (const l of lines) {
      if (l.debit.isNegative() || l.credit.isNegative()) throw new BadRequestException('Amounts cannot be negative');
      if (!l.debit.isZero() && !l.credit.isZero()) {
        throw new BadRequestException('A line cannot have both a debit and a credit');
      }
    }
    const dr = lines.reduce((s, l) => s.plus(l.debit), ZERO);
    const cr = lines.reduce((s, l) => s.plus(l.credit), ZERO);
    if (!dr.equals(cr)) throw new BadRequestException(`Entry is unbalanced: debits ${dr} ≠ credits ${cr}`);
    if (dr.isZero()) throw new BadRequestException('Entry total cannot be zero');
  }
}
