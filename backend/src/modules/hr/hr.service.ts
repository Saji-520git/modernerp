import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';

// ─── DTOs ──────────────────────────────────────────────────────────────────────

export interface CreateStaffDto {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  designation?: string | null;
  department?: string | null;
  employmentType?: string;
  joinDate: string | Date;
  salaryType?: string;
  basicSalaryCents?: number;
  userId?: string | null;
}

export type UpdateStaffDto = Partial<CreateStaffDto>;

export interface MarkAttendanceDto {
  staffId: string;
  date: string | Date;
  status?: string; // PRESENT | ABSENT | LATE | HALF_DAY | LEAVE
  clockIn?: string | Date | null;
  clockOut?: string | Date | null;
  notes?: string | null;
}

export interface ApplyLeaveDto {
  staffId: string;
  leaveType?: string;
  startDate: string | Date;
  endDate: string | Date;
  reason?: string | null;
}

export interface SalaryAdjustments {
  allowancesCents?: number;
  deductionsCents?: number;
  notes?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** First day (inclusive) and next-month first day (exclusive) for a month. */
function monthRange(month: number, year: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  return { start, end };
}

/** Calendar days in a month (used as the working-day basis for salary). */
function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate();
}

/** Inclusive whole-day difference between two dates. */
function inclusiveDays(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.floor(ms / 86_400_000) + 1);
}

/** Next employeeId in the EMP-0001 sequence (derived from the current max). */
async function nextEmployeeId(): Promise<string> {
  const last = await prisma.staff.findFirst({
    orderBy: { employeeId: 'desc' },
    select: { employeeId: true },
  });
  const lastNum = last ? parseInt(last.employeeId.replace(/\D/g, ''), 10) || 0 : 0;
  return `EMP-${String(lastNum + 1).padStart(4, '0')}`;
}

interface AttendanceCounts {
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  leave: number;
}

function countStatuses(rows: { status: string }[]): AttendanceCounts {
  const c: AttendanceCounts = { present: 0, absent: 0, late: 0, halfDay: 0, leave: 0 };
  for (const r of rows) {
    switch (r.status) {
      case 'PRESENT':  c.present++; break;
      case 'ABSENT':   c.absent++;  break;
      case 'LATE':     c.late++;    break;
      case 'HALF_DAY': c.halfDay++; break;
      case 'LEAVE':    c.leave++;   break;
    }
  }
  return c;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const hrService = {

  // ── Staff ──────────────────────────────────────────────────────────────────

  getAllStaff: async (filters?: { isActive?: boolean; department?: string; search?: string }) => {
    try {
      const where: Prisma.StaffWhereInput = { deletedAt: null };
      if (filters?.isActive !== undefined) where.isActive = filters.isActive;
      if (filters?.department) where.department = filters.department;
      if (filters?.search) {
        const s = filters.search;
        where.OR = [
          { firstName:  { contains: s, mode: 'insensitive' } },
          { lastName:   { contains: s, mode: 'insensitive' } },
          { employeeId: { contains: s, mode: 'insensitive' } },
          { phone:      { contains: s, mode: 'insensitive' } },
        ];
      }
      return await prisma.staff.findMany({ where, orderBy: { fullName: 'asc' } });
    } catch (err) {
      logger.error(err, 'hrService.getAllStaff failed');
      throw err;
    }
  },

  getStaffById: async (id: string) => {
    try {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const staff = await prisma.staff.findFirst({
        where: { id, deletedAt: null },
        include: {
          attendances: { where: { date: { gte: since } }, orderBy: { date: 'desc' } },
          salaries:    { orderBy: [{ year: 'desc' }, { month: 'desc' }] },
          leaves:      { orderBy: { startDate: 'desc' } },
        },
      });
      if (!staff) throw new HttpError(404, 'Staff not found');
      return staff;
    } catch (err) {
      logger.error(err, 'hrService.getStaffById failed');
      throw err;
    }
  },

  createStaff: async (data: CreateStaffDto) => {
    try {
      if (data.email) {
        const existing = await prisma.staff.findUnique({ where: { email: data.email } });
        if (existing) throw new HttpError(409, 'A staff member with this email already exists');
      }
      const employeeId = await nextEmployeeId();
      return await prisma.staff.create({
        data: {
          employeeId,
          firstName:        data.firstName,
          lastName:         data.lastName,
          fullName:         `${data.firstName} ${data.lastName}`.trim(),
          email:            data.email ?? null,
          phone:            data.phone ?? null,
          address:          data.address ?? null,
          designation:      data.designation ?? null,
          department:       data.department ?? null,
          employmentType:   data.employmentType ?? 'FULL_TIME',
          joinDate:         new Date(data.joinDate),
          salaryType:       data.salaryType ?? 'MONTHLY',
          basicSalaryCents: data.basicSalaryCents ?? 0,
          userId:           data.userId ?? null,
        },
      });
    } catch (err) {
      logger.error(err, 'hrService.createStaff failed');
      throw err;
    }
  },

  updateStaff: async (id: string, data: UpdateStaffDto) => {
    try {
      const staff = await prisma.staff.findFirst({ where: { id, deletedAt: null } });
      if (!staff) throw new HttpError(404, 'Staff not found');

      if (data.email && data.email !== staff.email) {
        const dup = await prisma.staff.findUnique({ where: { email: data.email } });
        if (dup) throw new HttpError(409, 'A staff member with this email already exists');
      }

      const patch: Prisma.StaffUpdateInput = {};
      if (data.firstName !== undefined)        patch.firstName = data.firstName;
      if (data.lastName !== undefined)         patch.lastName = data.lastName;
      if (data.firstName !== undefined || data.lastName !== undefined) {
        patch.fullName = `${data.firstName ?? staff.firstName} ${data.lastName ?? staff.lastName}`.trim();
      }
      if (data.email !== undefined)            patch.email = data.email;
      if (data.phone !== undefined)            patch.phone = data.phone;
      if (data.address !== undefined)          patch.address = data.address;
      if (data.designation !== undefined)      patch.designation = data.designation;
      if (data.department !== undefined)       patch.department = data.department;
      if (data.employmentType !== undefined)   patch.employmentType = data.employmentType;
      if (data.joinDate !== undefined)         patch.joinDate = new Date(data.joinDate);
      if (data.salaryType !== undefined)       patch.salaryType = data.salaryType;
      if (data.basicSalaryCents !== undefined) patch.basicSalaryCents = data.basicSalaryCents;
      if (data.userId !== undefined) {
        patch.user = data.userId ? { connect: { id: data.userId } } : { disconnect: true };
      }

      return await prisma.staff.update({ where: { id }, data: patch });
    } catch (err) {
      logger.error(err, 'hrService.updateStaff failed');
      throw err;
    }
  },

  deleteStaff: async (id: string) => {
    try {
      const staff = await prisma.staff.findFirst({ where: { id, deletedAt: null } });
      if (!staff) throw new HttpError(404, 'Staff not found');
      return await prisma.staff.update({
        where: { id },
        data:  { deletedAt: new Date(), isActive: false },
      });
    } catch (err) {
      logger.error(err, 'hrService.deleteStaff failed');
      throw err;
    }
  },

  // ── Attendance ───────────────────────────────────────────────────────────

  getAttendance: async (staffId: string, month: number, year: number) => {
    try {
      const { start, end } = monthRange(month, year);
      const records = await prisma.attendance.findMany({
        where: { staffId, date: { gte: start, lt: end } },
        orderBy: { date: 'asc' },
      });
      return { records, summary: countStatuses(records) };
    } catch (err) {
      logger.error(err, 'hrService.getAttendance failed');
      throw err;
    }
  },

  markAttendance: async (data: MarkAttendanceDto) => {
    try {
      const date = new Date(data.date);
      const status = data.status ?? 'PRESENT';
      return await prisma.attendance.upsert({
        where:  { staffId_date: { staffId: data.staffId, date } },
        update: {
          status,
          clockIn:  data.clockIn  != null ? new Date(data.clockIn)  : null,
          clockOut: data.clockOut != null ? new Date(data.clockOut) : null,
          notes:    data.notes ?? null,
        },
        create: {
          staffId:  data.staffId,
          date,
          status,
          clockIn:  data.clockIn  != null ? new Date(data.clockIn)  : null,
          clockOut: data.clockOut != null ? new Date(data.clockOut) : null,
          notes:    data.notes ?? null,
        },
      });
    } catch (err) {
      logger.error(err, 'hrService.markAttendance failed');
      throw err;
    }
  },

  bulkMarkAttendance: async (date: string | Date, records: MarkAttendanceDto[]) => {
    try {
      const day = new Date(date);
      const ops = records.map((r) => {
        const status = r.status ?? 'PRESENT';
        return prisma.attendance.upsert({
          where:  { staffId_date: { staffId: r.staffId, date: day } },
          update: {
            status,
            clockIn:  r.clockIn  != null ? new Date(r.clockIn)  : null,
            clockOut: r.clockOut != null ? new Date(r.clockOut) : null,
            notes:    r.notes ?? null,
          },
          create: {
            staffId: r.staffId,
            date:    day,
            status,
            clockIn:  r.clockIn  != null ? new Date(r.clockIn)  : null,
            clockOut: r.clockOut != null ? new Date(r.clockOut) : null,
            notes:    r.notes ?? null,
          },
        });
      });
      const saved = await prisma.$transaction(ops);
      return { saved: saved.length };
    } catch (err) {
      logger.error(err, 'hrService.bulkMarkAttendance failed');
      throw err;
    }
  },

  getAttendanceSummary: async (month: number, year: number) => {
    try {
      const { start, end } = monthRange(month, year);
      const staff = await prisma.staff.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: { fullName: 'asc' },
        include: { attendances: { where: { date: { gte: start, lt: end } }, select: { status: true } } },
      });
      return staff.map((s) => ({
        staffId:     s.id,
        employeeId:  s.employeeId,
        fullName:    s.fullName,
        department:  s.department,
        ...countStatuses(s.attendances),
      }));
    } catch (err) {
      logger.error(err, 'hrService.getAttendanceSummary failed');
      throw err;
    }
  },

  // ── Salary ─────────────────────────────────────────────────────────────────

  getMonthlySalary: async (month: number, year: number) => {
    try {
      return await prisma.salary.findMany({
        where: { month, year },
        include: { staff: { select: { fullName: true, designation: true, department: true, employeeId: true } } },
        orderBy: { staff: { fullName: 'asc' } },
      });
    } catch (err) {
      logger.error(err, 'hrService.getMonthlySalary failed');
      throw err;
    }
  },

  /** Auto-calculate a salary preview (not persisted). */
  calculateSalary: async (staffId: string, month: number, year: number) => {
    try {
      const staff = await prisma.staff.findFirst({ where: { id: staffId, deletedAt: null } });
      if (!staff) throw new HttpError(404, 'Staff not found');

      const { start, end } = monthRange(month, year);
      const attendance = await prisma.attendance.findMany({
        where: { staffId, date: { gte: start, lt: end } },
        select: { status: true },
      });
      const counts = countStatuses(attendance);
      const workingDays = daysInMonth(month, year);
      const perDayCents = workingDays > 0 ? Math.round(staff.basicSalaryCents / workingDays) : 0;

      // Absent days lose a full day; half-days lose half a day.
      const absenceUnits = counts.absent + counts.halfDay * 0.5;
      const deductionsCents = Math.round(perDayCents * absenceUnits);
      const basicCents = staff.basicSalaryCents;
      const netCents = Math.max(0, basicCents - deductionsCents);

      return {
        staffId,
        fullName:    staff.fullName,
        designation: staff.designation,
        month,
        year,
        workingDays,
        presentDays: counts.present + counts.late,
        absentDays:  counts.absent,
        halfDays:    counts.halfDay,
        leaveDays:   counts.leave,
        perDayCents,
        basicCents,
        allowancesCents: 0,
        deductionsCents,
        netCents,
      };
    } catch (err) {
      logger.error(err, 'hrService.calculateSalary failed');
      throw err;
    }
  },

  /** Persist a salary record (marks PAID). Upserts on staff+month+year. */
  processSalary: async (staffId: string, month: number, year: number, adjustments?: SalaryAdjustments) => {
    try {
      const calc = await hrService.calculateSalary(staffId, month, year);
      const allowancesCents = adjustments?.allowancesCents ?? 0;
      const extraDeductions = adjustments?.deductionsCents ?? 0;
      const deductionsCents = calc.deductionsCents + extraDeductions;
      const netCents = Math.max(0, calc.basicCents + allowancesCents - deductionsCents);

      return await prisma.salary.upsert({
        where:  { staffId_month_year: { staffId, month, year } },
        update: {
          basicCents: calc.basicCents,
          allowancesCents,
          deductionsCents,
          netCents,
          status: 'PAID',
          paidAt: new Date(),
          notes:  adjustments?.notes ?? null,
        },
        create: {
          staffId,
          month,
          year,
          basicCents: calc.basicCents,
          allowancesCents,
          deductionsCents,
          netCents,
          status: 'PAID',
          paidAt: new Date(),
          notes:  adjustments?.notes ?? null,
        },
      });
    } catch (err) {
      logger.error(err, 'hrService.processSalary failed');
      throw err;
    }
  },

  /** Process salary for every active staff member at once. */
  processPayroll: async (month: number, year: number) => {
    try {
      const staff = await prisma.staff.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true } });
      let processed = 0;
      let skipped = 0;
      let totalPaidCents = 0;
      for (const s of staff) {
        const existing = await prisma.salary.findUnique({
          where: { staffId_month_year: { staffId: s.id, month, year } },
        });
        if (existing?.status === 'PAID') { skipped++; continue; }
        const result = await hrService.processSalary(s.id, month, year);
        totalPaidCents += result.netCents;
        processed++;
      }
      return { processed, skipped, totalStaff: staff.length, totalPaidCents };
    } catch (err) {
      logger.error(err, 'hrService.processPayroll failed');
      throw err;
    }
  },

  // ── Leave ──────────────────────────────────────────────────────────────────

  getLeaves: async (filters?: { staffId?: string; status?: string; year?: number }) => {
    try {
      const where: Prisma.LeaveWhereInput = {};
      if (filters?.staffId) where.staffId = filters.staffId;
      if (filters?.status)  where.status = filters.status;
      if (filters?.year) {
        const { start } = monthRange(1, filters.year);
        const { end }   = monthRange(12, filters.year);
        where.startDate = { gte: start, lt: end };
      }
      return await prisma.leave.findMany({
        where,
        include: { staff: { select: { fullName: true, employeeId: true, department: true } } },
        orderBy: { startDate: 'desc' },
      });
    } catch (err) {
      logger.error(err, 'hrService.getLeaves failed');
      throw err;
    }
  },

  applyLeave: async (data: ApplyLeaveDto) => {
    try {
      const staff = await prisma.staff.findFirst({ where: { id: data.staffId, deletedAt: null } });
      if (!staff) throw new HttpError(404, 'Staff not found');
      const startDate = new Date(data.startDate);
      const endDate = new Date(data.endDate);
      if (endDate < startDate) throw new HttpError(400, 'End date cannot be before start date');
      return await prisma.leave.create({
        data: {
          staffId:   data.staffId,
          leaveType: data.leaveType ?? 'ANNUAL',
          startDate,
          endDate,
          days:      inclusiveDays(startDate, endDate),
          reason:    data.reason ?? null,
          status:    'PENDING',
        },
      });
    } catch (err) {
      logger.error(err, 'hrService.applyLeave failed');
      throw err;
    }
  },

  updateLeaveStatus: async (id: string, status: 'APPROVED' | 'REJECTED', approvedBy: string) => {
    try {
      const leave = await prisma.leave.findUnique({ where: { id } });
      if (!leave) throw new HttpError(404, 'Leave not found');
      return await prisma.leave.update({
        where: { id },
        data:  { status, approvedBy, approvedAt: new Date() },
      });
    } catch (err) {
      logger.error(err, 'hrService.updateLeaveStatus failed');
      throw err;
    }
  },

  // ── Reports ────────────────────────────────────────────────────────────────

  getAttendanceReport: async (month: number, year: number) => {
    try {
      const { start, end } = monthRange(month, year);
      const totalDays = daysInMonth(month, year);
      const staff = await prisma.staff.findMany({
        where: { deletedAt: null, isActive: true },
        orderBy: [{ department: 'asc' }, { fullName: 'asc' }],
        include: { attendances: { where: { date: { gte: start, lt: end } }, select: { status: true } } },
      });
      return staff.map((s) => {
        const c = countStatuses(s.attendances);
        const attended = c.present + c.late + c.halfDay * 0.5;
        const percentage = totalDays > 0 ? Math.round((attended / totalDays) * 1000) / 10 : 0;
        return {
          staffId:    s.id,
          employeeId: s.employeeId,
          fullName:   s.fullName,
          department: s.department,
          present:    c.present,
          absent:     c.absent,
          late:       c.late,
          halfDay:    c.halfDay,
          leave:      c.leave,
          totalDays,
          attendancePct: percentage,
        };
      });
    } catch (err) {
      logger.error(err, 'hrService.getAttendanceReport failed');
      throw err;
    }
  },

  getPayrollReport: async (month: number, year: number) => {
    try {
      const rows = await prisma.salary.findMany({
        where: { month, year },
        include: { staff: { select: { fullName: true, designation: true, department: true, employeeId: true } } },
        orderBy: [{ staff: { department: 'asc' } }, { staff: { fullName: 'asc' } }],
      });

      const departmentTotals: Record<string, { basicCents: number; allowancesCents: number; deductionsCents: number; netCents: number }> = {};
      const grand = { basicCents: 0, allowancesCents: 0, deductionsCents: 0, netCents: 0 };

      for (const r of rows) {
        const dept = r.staff.department ?? 'Unassigned';
        const dt = departmentTotals[dept] ?? { basicCents: 0, allowancesCents: 0, deductionsCents: 0, netCents: 0 };
        dt.basicCents += r.basicCents;
        dt.allowancesCents += r.allowancesCents;
        dt.deductionsCents += r.deductionsCents;
        dt.netCents += r.netCents;
        departmentTotals[dept] = dt;

        grand.basicCents += r.basicCents;
        grand.allowancesCents += r.allowancesCents;
        grand.deductionsCents += r.deductionsCents;
        grand.netCents += r.netCents;
      }

      return { rows, departmentTotals, grandTotal: grand };
    } catch (err) {
      logger.error(err, 'hrService.getPayrollReport failed');
      throw err;
    }
  },
};
