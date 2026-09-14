import { BadRequestException, Body, Controller, Delete, Get, Injectable, Module, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { AttendanceStatus, EmployeeStatus, LeaveStatus, PayrollStatus, Prisma, Role } from '@prisma/client';
import type { Response } from 'express';
import { PdfService, pdfResponse } from '../common/pdf.service';
import { z } from 'zod';
import { AccountingModule } from '../accounting/accounting.module';
import { LedgerService } from '../accounting/ledger.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { AuditService, SequenceService } from '../common/common.module';
import { businessDays, endOfDay, maxDate, minDate, startOfDay } from '../common/dates';
import { D, Decimal, round2, ZERO } from '../common/money';
import { contains, listQuerySchema, pageArgs, paged, zDate, zId, zMoney, zOptStr, zPct, ZodPipe } from '../common/zod';
import { PrismaService, Tx } from '../prisma/prisma.service';

const departmentSchema = z.object({ name: z.string().trim().min(1).max(100) });

const employeeSchema = z.object({
  code: z.string().trim().max(30).optional(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  email: zOptStr,
  phone: zOptStr,
  jobTitle: zOptStr,
  departmentId: z.string().min(1).nullish(),
  hireDate: zDate,
  terminationDate: zDate.nullish(),
  status: z.nativeEnum(EmployeeStatus).default('ACTIVE'),
  baseSalary: zMoney,
  allowances: zMoney.default(0),
  taxRatePct: zPct.default(0),
  bankAccount: zOptStr,
  userId: z.string().min(1).nullish(),
});
type EmployeeDto = z.infer<typeof employeeSchema>;

const employeeQuerySchema = listQuerySchema.extend({ status: z.nativeEnum(EmployeeStatus).optional(), departmentId: z.string().optional() });

const attendanceSchema = z.object({
  employeeId: zId,
  date: zDate,
  status: z.nativeEnum(AttendanceStatus).default('PRESENT'),
  checkIn: zDate.nullish(),
  checkOut: zDate.nullish(),
  notes: zOptStr,
});
type AttendanceDto = z.infer<typeof attendanceSchema>;
const attendanceQuerySchema = z.object({ from: zDate, to: zDate, employeeId: z.string().optional() });

const leaveTypeSchema = z.object({ name: z.string().trim().min(1), daysPerYear: z.coerce.number().int().min(0).max(366), isPaid: z.boolean().default(true) });
const leaveRequestSchema = z
  .object({ employeeId: zId, leaveTypeId: zId, startDate: zDate, endDate: zDate, reason: zOptStr })
  .refine((l) => l.endDate >= l.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] });
type LeaveRequestDto = z.infer<typeof leaveRequestSchema>;
const leaveQuerySchema = listQuerySchema.extend({ status: z.nativeEnum(LeaveStatus).optional(), employeeId: z.string().optional() });

const payrollRunSchema = z
  .object({ periodStart: zDate, periodEnd: zDate, payDate: zDate })
  .refine((p) => p.periodEnd >= p.periodStart, { message: 'Period end must be after period start', path: ['periodEnd'] });
const payslipUpdateSchema = z.object({ overtime: zMoney.default(0), otherDeductions: zMoney.default(0) });
const payrollPaySchema = z.object({ accountId: zId });
const payrollQuerySchema = listQuerySchema.extend({ status: z.nativeEnum(PayrollStatus).optional() });

@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly seq: SequenceService,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
    private readonly pdf: PdfService,
  ) {}

  // ── Employees ──

  async listEmployees(q: z.infer<typeof employeeQuerySchema>) {
    const where: Prisma.EmployeeWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.departmentId && { departmentId: q.departmentId }),
      ...(q.search && {
        OR: [{ firstName: contains(q.search) }, { lastName: contains(q.search) }, { code: contains(q.search) }, { email: contains(q.search) }],
      }),
    };
    const [items, total] = await Promise.all([
      this.prisma.employee.findMany({
        where,
        include: { department: { select: { id: true, name: true } } },
        orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
        ...pageArgs(q),
      }),
      this.prisma.employee.count({ where }),
    ]);
    return paged(items, total, q);
  }

  async getEmployee(id: string) {
    const employee = await this.prisma.employee.findUniqueOrThrow({
      where: { id },
      include: {
        department: true,
        user: { select: { id: true, email: true, role: true } },
        leaveRequests: { take: 20, orderBy: { startDate: 'desc' }, include: { leaveType: true } },
        payslips: { take: 12, orderBy: { run: { periodStart: 'desc' } }, include: { run: { select: { number: true, periodStart: true, periodEnd: true, status: true } } } },
      },
    });
    return { ...employee, leaveBalances: await this.leaveBalances(this.prisma, id, new Date()) };
  }

  createEmployee(user: AuthUser, dto: EmployeeDto) {
    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({ data: { ...dto, code: dto.code || (await this.seq.next(tx, 'EMP')) } });
      await this.audit.log(user.sub, 'create', 'Employee', employee.id, undefined, tx);
      return employee;
    });
  }

  async updateEmployee(user: AuthUser, id: string, dto: Partial<EmployeeDto>) {
    const employee = await this.prisma.employee.update({ where: { id }, data: dto });
    await this.audit.log(user.sub, 'update', 'Employee', id, dto);
    return employee;
  }

  // ── Attendance ──

  listAttendance(q: z.infer<typeof attendanceQuerySchema>) {
    return this.prisma.attendance.findMany({
      where: { date: { gte: startOfDay(q.from), lte: endOfDay(q.to) }, ...(q.employeeId && { employeeId: q.employeeId }) },
      include: { employee: { select: { id: true, code: true, firstName: true, lastName: true } } },
      orderBy: [{ date: 'desc' }, { employee: { firstName: 'asc' } }],
    });
  }

  upsertAttendance(dto: AttendanceDto) {
    const date = startOfDay(dto.date);
    const data = { status: dto.status, checkIn: dto.checkIn, checkOut: dto.checkOut, notes: dto.notes };
    return this.prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: dto.employeeId, date } },
      create: { employeeId: dto.employeeId, date, ...data },
      update: data,
    });
  }

  // ── Leave ──

  private async leaveBalances(tx: Tx, employeeId: string, asOf: Date) {
    const yearStart = new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));
    const yearEnd = new Date(Date.UTC(asOf.getUTCFullYear(), 11, 31));
    const [types, used] = await Promise.all([
      tx.leaveType.findMany({ orderBy: { name: 'asc' } }),
      tx.leaveRequest.groupBy({
        by: ['leaveTypeId', 'status'],
        where: { employeeId, status: { in: ['APPROVED', 'PENDING'] }, startDate: { gte: yearStart, lte: yearEnd } },
        _sum: { days: true },
      }),
    ]);
    return types.map((t) => {
      const taken = used.filter((u) => u.leaveTypeId === t.id && u.status === 'APPROVED').reduce((s, u) => s.plus(D(u._sum.days)), ZERO);
      const pending = used.filter((u) => u.leaveTypeId === t.id && u.status === 'PENDING').reduce((s, u) => s.plus(D(u._sum.days)), ZERO);
      return { leaveTypeId: t.id, name: t.name, entitled: t.daysPerYear, taken, pending, remaining: D(t.daysPerYear).minus(taken).minus(pending) };
    });
  }

  async listLeave(q: z.infer<typeof leaveQuerySchema>) {
    const where: Prisma.LeaveRequestWhereInput = {
      ...(q.status && { status: q.status }),
      ...(q.employeeId && { employeeId: q.employeeId }),
      ...(q.search && { employee: { OR: [{ firstName: contains(q.search) }, { lastName: contains(q.search) }] } }),
    };
    const [items, total] = await Promise.all([
      this.prisma.leaveRequest.findMany({
        where,
        include: {
          employee: { select: { id: true, code: true, firstName: true, lastName: true } },
          leaveType: true,
          approvedBy: { select: { name: true } },
        },
        orderBy: { startDate: 'desc' },
        ...pageArgs(q),
      }),
      this.prisma.leaveRequest.count({ where }),
    ]);
    return paged(items, total, q);
  }

  requestLeave(user: AuthUser, dto: LeaveRequestDto) {
    return this.prisma.$transaction(async (tx) => {
      const days = businessDays(dto.startDate, dto.endDate);
      if (days === 0) throw new BadRequestException('The selected range contains no working days');
      const overlap = await tx.leaveRequest.count({
        where: {
          employeeId: dto.employeeId,
          status: { in: ['PENDING', 'APPROVED'] },
          startDate: { lte: dto.endDate },
          endDate: { gte: dto.startDate },
        },
      });
      if (overlap) throw new BadRequestException('This overlaps an existing leave request');
      const type = await tx.leaveType.findUniqueOrThrow({ where: { id: dto.leaveTypeId } });
      if (type.daysPerYear > 0) {
        const balance = (await this.leaveBalances(tx, dto.employeeId, dto.startDate)).find((b) => b.leaveTypeId === type.id);
        if (balance && balance.remaining.lt(days)) {
          throw new BadRequestException(`Insufficient ${type.name} balance: ${balance.remaining} day(s) remaining, ${days} requested`);
        }
      }
      const request = await tx.leaveRequest.create({
        data: { ...dto, startDate: startOfDay(dto.startDate), endDate: startOfDay(dto.endDate), days },
      });
      await this.audit.log(user.sub, 'create', 'LeaveRequest', request.id, undefined, tx);
      return request;
    });
  }

  async decideLeave(user: AuthUser, id: string, status: 'APPROVED' | 'REJECTED' | 'CANCELLED') {
    const request = await this.prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
    const allowedFrom: LeaveStatus[] = status === 'CANCELLED' ? ['PENDING', 'APPROVED'] : ['PENDING'];
    if (!allowedFrom.includes(request.status)) throw new BadRequestException(`Request is already ${request.status.toLowerCase()}`);
    const updated = await this.prisma.leaveRequest.update({
      where: { id },
      data: { status, approvedById: status === 'CANCELLED' ? request.approvedById : user.sub },
    });
    await this.audit.log(user.sub, status.toLowerCase(), 'LeaveRequest', id);
    return updated;
  }

  // ── Payroll ──

  async listRuns(q: z.infer<typeof payrollQuerySchema>) {
    const where: Prisma.PayrollRunWhereInput = q.status ? { status: q.status } : {};
    const [items, total] = await Promise.all([
      this.prisma.payrollRun.findMany({ where, include: { _count: { select: { payslips: true } } }, orderBy: { periodStart: 'desc' }, ...pageArgs(q) }),
      this.prisma.payrollRun.count({ where }),
    ]);
    return paged(items, total, q);
  }

  getRun(id: string) {
    return this.prisma.payrollRun.findUniqueOrThrow({
      where: { id },
      include: {
        payslips: {
          include: { employee: { select: { id: true, code: true, firstName: true, lastName: true, jobTitle: true, bankAccount: true } } },
          orderBy: { employee: { firstName: 'asc' } },
        },
      },
    });
  }

  async payslipPdf(runId: string, payslipId: string) {
    const slip = await this.prisma.payslip.findUniqueOrThrow({
      where: { id: payslipId },
      include: { run: true, employee: { include: { department: true } } },
    });
    if (slip.runId !== runId) throw new BadRequestException('Payslip does not belong to this run');
    const e = slip.employee;
    const deductions = D(slip.taxAmount).plus(slip.otherDeductions);
    const buffer = await this.pdf.render((f) => ({
      title: 'Payslip',
      number: slip.run.number,
      status: slip.run.status === 'DRAFT' ? 'Draft — not approved' : undefined,
      party: { label: 'Employee', name: `${e.firstName} ${e.lastName}`, lines: [e.code, e.jobTitle, e.department?.name, e.bankAccount && `Bank account ${e.bankAccount}`] },
      meta: [
        ['Pay period', `${f.date(slip.run.periodStart)} – ${f.date(slip.run.periodEnd)}`],
        ['Pay date', f.date(slip.run.payDate)],
      ],
      columns: [
        { header: 'Description', width: 349 },
        { header: 'Amount', width: 150, align: 'right' },
      ],
      rows: [
        { cells: ['Base salary', f.money(slip.baseSalary)] },
        { cells: ['Allowances', f.money(slip.allowances)] },
        { cells: ['Overtime', f.money(slip.overtime)] },
        { cells: ['Unpaid leave deduction', `−${f.money(slip.unpaidLeaveDeduction)}`] },
        { cells: [`Income tax (${f.pct(e.taxRatePct)})`, `−${f.money(slip.taxAmount)}`] },
        { cells: ['Other deductions', `−${f.money(slip.otherDeductions)}`] },
      ],
      totals: [
        ['Gross pay', f.money(slip.grossPay)],
        ['Total deductions', f.money(deductions)],
        ['Net pay', f.money(slip.netPay), true],
      ],
    }));
    return { buffer, filename: `${slip.run.number}-${e.code}.pdf` };
  }

  private computeSlip(p: { baseSalary: Decimal; allowances: Decimal; overtime: Decimal; unpaidLeaveDeduction: Decimal; otherDeductions: Decimal; taxRatePct: Decimal }) {
    const grossPay = round2(p.baseSalary.plus(p.allowances).plus(p.overtime).minus(p.unpaidLeaveDeduction));
    const taxAmount = round2(grossPay.mul(p.taxRatePct).div(100));
    const netPay = grossPay.minus(taxAmount).minus(p.otherDeductions);
    if (netPay.isNegative()) throw new BadRequestException('Deductions exceed gross pay');
    return { grossPay, taxAmount, netPay };
  }

  private async refreshTotals(tx: Tx, runId: string) {
    const slips = await tx.payslip.findMany({ where: { runId } });
    const totalGross = slips.reduce((s, p) => s.plus(p.grossPay), ZERO);
    const totalDeductions = slips.reduce((s, p) => s.plus(p.taxAmount).plus(p.otherDeductions), ZERO);
    const totalNet = slips.reduce((s, p) => s.plus(p.netPay), ZERO);
    return tx.payrollRun.update({ where: { id: runId }, data: { totalGross, totalDeductions, totalNet } });
  }

  createRun(user: AuthUser, dto: z.infer<typeof payrollRunSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const periodStart = startOfDay(dto.periodStart);
      const periodEnd = startOfDay(dto.periodEnd);
      const clash = await tx.payrollRun.count({ where: { periodStart: { lte: periodEnd }, periodEnd: { gte: periodStart } } });
      if (clash) throw new BadRequestException('A payroll run already covers part of this period');

      const employees = await tx.employee.findMany({
        where: {
          status: { not: 'TERMINATED' },
          hireDate: { lte: periodEnd },
          OR: [{ terminationDate: null }, { terminationDate: { gte: periodStart } }],
        },
      });
      if (!employees.length) throw new BadRequestException('No eligible employees for this period');

      const unpaidLeave = await tx.leaveRequest.findMany({
        where: { status: 'APPROVED', leaveType: { isPaid: false }, startDate: { lte: periodEnd }, endDate: { gte: periodStart } },
      });
      const workingDays = businessDays(periodStart, periodEnd) || 1;

      const payslips = employees.map((e) => {
        const unpaidDays = unpaidLeave
          .filter((l) => l.employeeId === e.id)
          .reduce((n, l) => n + businessDays(maxDate(l.startDate, periodStart), minDate(l.endDate, periodEnd)), 0);
        const baseSalary = D(e.baseSalary);
        const unpaidLeaveDeduction = Decimal.min(baseSalary, round2(baseSalary.div(workingDays).mul(unpaidDays)));
        const parts = { baseSalary, allowances: D(e.allowances), overtime: ZERO, unpaidLeaveDeduction, otherDeductions: ZERO, taxRatePct: D(e.taxRatePct) };
        const { taxRatePct: _rate, ...stored } = parts;
        return { employeeId: e.id, ...stored, ...this.computeSlip(parts) };
      });

      const run = await tx.payrollRun.create({
        data: { number: await this.seq.next(tx, 'PR'), periodStart, periodEnd, payDate: startOfDay(dto.payDate), payslips: { create: payslips } },
      });
      await this.audit.log(user.sub, 'create', 'PayrollRun', run.id, undefined, tx);
      return this.refreshTotals(tx, run.id);
    });
  }

  updatePayslip(runId: string, payslipId: string, dto: z.infer<typeof payslipUpdateSchema>) {
    return this.prisma.$transaction(async (tx) => {
      const slip = await tx.payslip.findUniqueOrThrow({ where: { id: payslipId }, include: { run: true, employee: true } });
      if (slip.runId !== runId) throw new BadRequestException('Payslip does not belong to this run');
      if (slip.run.status !== 'DRAFT') throw new BadRequestException('Only draft payroll runs can be edited');
      const overtime = D(dto.overtime);
      const otherDeductions = D(dto.otherDeductions);
      const computed = this.computeSlip({
        baseSalary: D(slip.baseSalary),
        allowances: D(slip.allowances),
        overtime,
        unpaidLeaveDeduction: D(slip.unpaidLeaveDeduction),
        otherDeductions,
        taxRatePct: D(slip.employee.taxRatePct),
      });
      await tx.payslip.update({ where: { id: payslipId }, data: { overtime, otherDeductions, ...computed } });
      return this.refreshTotals(tx, runId);
    });
  }

  async deleteRun(user: AuthUser, id: string) {
    const run = await this.prisma.payrollRun.findUniqueOrThrow({ where: { id } });
    if (run.status !== 'DRAFT') throw new BadRequestException('Only draft payroll runs can be deleted');
    await this.prisma.payrollRun.delete({ where: { id } });
    await this.audit.log(user.sub, 'delete', 'PayrollRun', id);
    return { ok: true };
  }

  approveRun(user: AuthUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findUniqueOrThrow({ where: { id } });
      if (run.status !== 'DRAFT') throw new BadRequestException('Only draft payroll runs can be approved');
      const entry = await this.ledger.post(tx, {
        date: run.periodEnd,
        description: `Payroll ${run.number}`,
        reference: run.number,
        sourceType: 'PAYROLL',
        sourceId: run.id,
        lines: [
          { key: 'SALARY_EXPENSE', debit: run.totalGross },
          { key: 'PAYROLL_TAX_PAYABLE', credit: run.totalDeductions },
          { key: 'SALARY_PAYABLE', credit: run.totalNet },
        ],
      });
      await this.audit.log(user.sub, 'approve', 'PayrollRun', id, undefined, tx);
      return tx.payrollRun.update({ where: { id }, data: { status: 'APPROVED', journalEntryId: entry.id } });
    });
  }

  payRun(user: AuthUser, id: string, accountId: string) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findUniqueOrThrow({ where: { id } });
      if (run.status !== 'APPROVED') throw new BadRequestException('Approve the payroll run before paying it');
      const account = await tx.account.findUnique({ where: { id: accountId } });
      if (account?.type !== 'ASSET') throw new BadRequestException('Pay from a cash or bank (asset) account');
      const entry = await this.ledger.post(tx, {
        date: run.payDate,
        description: `Salary payment ${run.number}`,
        reference: run.number,
        sourceType: 'PAYROLL',
        sourceId: run.id,
        lines: [
          { key: 'SALARY_PAYABLE', debit: run.totalNet },
          { accountId, credit: run.totalNet },
        ],
      });
      await this.audit.log(user.sub, 'pay', 'PayrollRun', id, undefined, tx);
      return tx.payrollRun.update({ where: { id }, data: { status: 'PAID', paymentEntryId: entry.id } });
    });
  }
}

type Q<T extends z.ZodTypeAny> = z.infer<T>;

@Roles(Role.HR)
@Controller('hr')
export class HrController {
  constructor(
    private readonly svc: HrService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('departments')
  listDepartments() {
    return this.prisma.department.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { employees: true } } } });
  }

  @Post('departments')
  createDepartment(@Body(new ZodPipe(departmentSchema)) dto: Q<typeof departmentSchema>) {
    return this.prisma.department.create({ data: dto });
  }

  @Patch('departments/:id')
  updateDepartment(@Param('id') id: string, @Body(new ZodPipe(departmentSchema)) dto: Q<typeof departmentSchema>) {
    return this.prisma.department.update({ where: { id }, data: dto });
  }

  @Get('employees')
  listEmployees(@Query(new ZodPipe(employeeQuerySchema)) q: Q<typeof employeeQuerySchema>) {
    return this.svc.listEmployees(q);
  }

  @Get('employees/:id')
  getEmployee(@Param('id') id: string) {
    return this.svc.getEmployee(id);
  }

  @Post('employees')
  createEmployee(@CurrentUser() u: AuthUser, @Body(new ZodPipe(employeeSchema)) dto: EmployeeDto) {
    return this.svc.createEmployee(u, dto);
  }

  @Patch('employees/:id')
  updateEmployee(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(employeeSchema.partial())) dto: Partial<EmployeeDto>) {
    return this.svc.updateEmployee(u, id, dto);
  }

  @Get('attendance')
  listAttendance(@Query(new ZodPipe(attendanceQuerySchema)) q: Q<typeof attendanceQuerySchema>) {
    return this.svc.listAttendance(q);
  }

  @Put('attendance')
  upsertAttendance(@Body(new ZodPipe(attendanceSchema)) dto: AttendanceDto) {
    return this.svc.upsertAttendance(dto);
  }

  @Get('leave-types')
  listLeaveTypes() {
    return this.prisma.leaveType.findMany({ orderBy: { name: 'asc' } });
  }

  @Post('leave-types')
  createLeaveType(@Body(new ZodPipe(leaveTypeSchema)) dto: Q<typeof leaveTypeSchema>) {
    return this.prisma.leaveType.create({ data: dto });
  }

  @Patch('leave-types/:id')
  updateLeaveType(@Param('id') id: string, @Body(new ZodPipe(leaveTypeSchema.partial())) dto: Partial<Q<typeof leaveTypeSchema>>) {
    return this.prisma.leaveType.update({ where: { id }, data: dto });
  }

  @Get('leave')
  listLeave(@Query(new ZodPipe(leaveQuerySchema)) q: Q<typeof leaveQuerySchema>) {
    return this.svc.listLeave(q);
  }

  @Post('leave')
  requestLeave(@CurrentUser() u: AuthUser, @Body(new ZodPipe(leaveRequestSchema)) dto: LeaveRequestDto) {
    return this.svc.requestLeave(u, dto);
  }

  @Post('leave/:id/approve')
  approveLeave(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.decideLeave(u, id, 'APPROVED');
  }

  @Post('leave/:id/reject')
  rejectLeave(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.decideLeave(u, id, 'REJECTED');
  }

  @Post('leave/:id/cancel')
  cancelLeave(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.decideLeave(u, id, 'CANCELLED');
  }

  @Get('payroll')
  listRuns(@Query(new ZodPipe(payrollQuerySchema)) q: Q<typeof payrollQuerySchema>) {
    return this.svc.listRuns(q);
  }

  @Get('payroll/:id')
  getRun(@Param('id') id: string) {
    return this.svc.getRun(id);
  }

  @Get('payroll/:id/payslips/:payslipId/pdf')
  async payslipPdf(@Param('id') id: string, @Param('payslipId') payslipId: string, @Res({ passthrough: true }) res: Response) {
    const { buffer, filename } = await this.svc.payslipPdf(id, payslipId);
    return pdfResponse(res, buffer, filename);
  }

  @Post('payroll')
  createRun(@CurrentUser() u: AuthUser, @Body(new ZodPipe(payrollRunSchema)) dto: Q<typeof payrollRunSchema>) {
    return this.svc.createRun(u, dto);
  }

  @Patch('payroll/:id/payslips/:payslipId')
  updatePayslip(@Param('id') id: string, @Param('payslipId') payslipId: string, @Body(new ZodPipe(payslipUpdateSchema)) dto: Q<typeof payslipUpdateSchema>) {
    return this.svc.updatePayslip(id, payslipId, dto);
  }

  @Delete('payroll/:id')
  deleteRun(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.deleteRun(u, id);
  }

  @Roles(Role.HR, Role.ACCOUNTANT)
  @Post('payroll/:id/approve')
  approveRun(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.approveRun(u, id);
  }

  @Roles(Role.ACCOUNTANT)
  @Post('payroll/:id/pay')
  payRun(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(new ZodPipe(payrollPaySchema)) dto: Q<typeof payrollPaySchema>) {
    return this.svc.payRun(u, id, dto.accountId);
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [HrController],
  providers: [HrService],
})
export class HrModule {}
