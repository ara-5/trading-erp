import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { PdfService } from './pdf.service';

@Injectable()
export class SequenceService {
  /** Atomically allocates the next document number for `key` (row-locked inside the transaction). */
  async next(tx: Tx, key: string): Promise<string> {
    const seq = await tx.numberSequence.upsert({
      where: { key },
      create: { key, prefix: `${key}-`, next: 2 },
      update: { next: { increment: 1 } },
    });
    return `${seq.prefix}${String(seq.next - 1).padStart(seq.padding, '0')}`;
  }
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    userId: string | undefined,
    action: string,
    entity: string,
    entityId?: string,
    data?: unknown,
    tx: Tx = this.prisma,
  ) {
    return tx.auditLog.create({
      data: {
        userId,
        action,
        entity,
        entityId,
        data: data === undefined ? undefined : (JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue),
      },
    });
  }
}

@Global()
@Module({
  providers: [SequenceService, AuditService, PdfService],
  exports: [SequenceService, AuditService, PdfService],
})
export class CommonModule {}
