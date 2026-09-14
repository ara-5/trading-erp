import { Body, Controller, Get, Injectable, Module, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Role, SystemAccountKey } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { z } from 'zod';
import { AuditService } from '../common/common.module';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { listQuerySchema, ListQuery, pageArgs, paged, zOptStr, ZodPipe } from '../common/zod';
import { PrismaService } from '../prisma/prisma.service';

const userCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1),
  password: z.string().min(8),
  role: z.nativeEnum(Role),
});
const userUpdateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
});
const settingsSchema = z.object({
  name: z.string().trim().min(1),
  legalName: zOptStr,
  taxNumber: zOptStr,
  email: zOptStr,
  phone: zOptStr,
  address: zOptStr,
  currency: z.string().trim().length(3).toUpperCase(),
  fiscalYearStart: z.coerce.number().int().min(1).max(12),
});
const systemAccountsSchema = z.record(z.nativeEnum(SystemAccountKey), z.string().min(1));

const userSelect = { id: true, email: true, name: true, role: true, isActive: true, createdAt: true } as const;

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listUsers(q: ListQuery) {
    const where = q.search
      ? { OR: [{ name: { contains: q.search, mode: 'insensitive' as const } }, { email: { contains: q.search, mode: 'insensitive' as const } }] }
      : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({ where, select: userSelect, orderBy: { name: 'asc' }, ...pageArgs(q) }),
      this.prisma.user.count({ where }),
    ]);
    return paged(items, total, q);
  }

  async createUser(actor: AuthUser, dto: z.infer<typeof userCreateSchema>) {
    const { password, ...rest } = dto;
    const user = await this.prisma.user.create({
      data: { ...rest, passwordHash: await bcrypt.hash(password, 10) },
      select: userSelect,
    });
    await this.audit.log(actor.sub, 'create', 'User', user.id, { email: user.email, role: user.role });
    return user;
  }

  async updateUser(actor: AuthUser, id: string, dto: z.infer<typeof userUpdateSchema>) {
    const { password, ...rest } = dto;
    const user = await this.prisma.user.update({
      where: { id },
      data: { ...rest, ...(password ? { passwordHash: await bcrypt.hash(password, 10) } : {}) },
      select: userSelect,
    });
    await this.audit.log(actor.sub, 'update', 'User', id, rest);
    return user;
  }

  getSettings() {
    return this.prisma.companySettings.findUnique({ where: { id: 1 } });
  }

  updateSettings(dto: z.infer<typeof settingsSchema>) {
    return this.prisma.companySettings.upsert({ where: { id: 1 }, create: { id: 1, ...dto }, update: dto });
  }

  getSystemAccounts() {
    return this.prisma.systemAccount.findMany({ include: { account: { select: { id: true, code: true, name: true } } } });
  }

  async setSystemAccounts(map: Partial<Record<SystemAccountKey, string>>) {
    await this.prisma.$transaction(
      Object.entries(map).map(([key, accountId]) =>
        this.prisma.systemAccount.upsert({
          where: { key: key as SystemAccountKey },
          create: { key: key as SystemAccountKey, accountId: accountId! },
          update: { accountId: accountId! },
        }),
      ),
    );
    return this.getSystemAccounts();
  }

  async auditLog(q: ListQuery) {
    const where = q.search ? { entity: { contains: q.search, mode: 'insensitive' as const } } : {};
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: { user: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        ...pageArgs(q),
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paged(items, total, q);
  }
}

@Controller('admin')
export class AdminController {
  constructor(private readonly svc: AdminService) {}

  @Roles(Role.ADMIN)
  @Get('users')
  listUsers(@Query(new ZodPipe(listQuerySchema)) q: ListQuery) {
    return this.svc.listUsers(q);
  }

  @Roles(Role.ADMIN)
  @Post('users')
  createUser(@CurrentUser() u: AuthUser, @Body(new ZodPipe(userCreateSchema)) dto: z.infer<typeof userCreateSchema>) {
    return this.svc.createUser(u, dto);
  }

  @Roles(Role.ADMIN)
  @Patch('users/:id')
  updateUser(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(userUpdateSchema)) dto: z.infer<typeof userUpdateSchema>) {
    return this.svc.updateUser(u, id, dto);
  }

  @Get('settings')
  getSettings() {
    return this.svc.getSettings();
  }

  @Roles(Role.ADMIN)
  @Put('settings')
  updateSettings(@Body(new ZodPipe(settingsSchema)) dto: z.infer<typeof settingsSchema>) {
    return this.svc.updateSettings(dto);
  }

  @Roles(Role.ACCOUNTANT)
  @Get('system-accounts')
  getSystemAccounts() {
    return this.svc.getSystemAccounts();
  }

  @Roles(Role.ADMIN)
  @Put('system-accounts')
  setSystemAccounts(@Body(new ZodPipe(systemAccountsSchema)) dto: z.infer<typeof systemAccountsSchema>) {
    return this.svc.setSystemAccounts(dto);
  }

  @Roles(Role.ADMIN)
  @Get('audit-log')
  auditLog(@Query(new ZodPipe(listQuerySchema)) q: ListQuery) {
    return this.svc.auditLog(q);
  }
}

@Module({
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
