import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { z, ZodTypeAny } from 'zod';

@Injectable()
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform {
  /** Public so the OpenAPI generator can derive request schemas from it. */
  constructor(readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return result.data;
  }
}

// Reusable field schemas
export const zId = z.string().min(1);
export const zDate = z.coerce.date();
export const zMoney = z.coerce.number().min(0).max(1e12);
export const zQty = z.coerce.number().positive().max(1e9);
export const zPct = z.coerce.number().min(0).max(100);
export const zOptStr = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .nullable()
  .transform((v) => (v === '' ? null : v));

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  search: z.string().trim().optional(),
  status: z.string().optional(),
});
export type ListQuery = z.infer<typeof listQuerySchema>;

export const contains = (s: string) => ({ contains: s, mode: 'insensitive' as const });

export function pageArgs(q: ListQuery) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function paged<T>(items: T[], total: number, q: ListQuery) {
  return { items, total, page: q.page, pageSize: q.pageSize };
}
