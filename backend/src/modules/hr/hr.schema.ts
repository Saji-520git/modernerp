import { z } from 'zod';

const attendanceStatus = z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'LEAVE']);

// ─── Staff ─────────────────────────────────────────────────────────────────

export const createStaffSchema = z.object({
  firstName:        z.string().min(1).max(80),
  lastName:         z.string().min(1).max(80),
  email:            z.string().email().max(160).optional().nullable(),
  phone:            z.string().max(40).optional().nullable(),
  address:          z.string().max(400).optional().nullable(),
  designation:      z.string().max(120).optional().nullable(),
  department:       z.string().max(120).optional().nullable(),
  employmentType:   z.string().max(40).optional(),
  joinDate:         z.string().min(1),
  salaryType:       z.string().max(40).optional(),
  basicSalaryCents: z.number().int().min(0).optional(),
  userId:           z.string().optional().nullable(),
});

export const updateStaffSchema = createStaffSchema.partial();

// ─── Attendance ──────────────────────────────────────────────────────────────

export const markAttendanceSchema = z.object({
  staffId:  z.string().min(1),
  date:     z.string().min(1),
  status:   attendanceStatus.optional(),
  clockIn:  z.string().optional().nullable(),
  clockOut: z.string().optional().nullable(),
  notes:    z.string().max(400).optional().nullable(),
});

export const bulkAttendanceSchema = z.object({
  date:    z.string().min(1),
  records: z.array(markAttendanceSchema.omit({ date: true }).extend({ date: z.string().optional() })).min(1),
});

// ─── Salary ────────────────────────────────────────────────────────────────

const monthYear = {
  month: z.number().int().min(1).max(12),
  year:  z.number().int().min(2000).max(2100),
};

export const calculateSalarySchema = z.object({
  staffId: z.string().min(1),
  ...monthYear,
});

export const processSalarySchema = z.object({
  staffId: z.string().min(1),
  ...monthYear,
  adjustments: z.object({
    allowancesCents: z.number().int().min(0).optional(),
    deductionsCents: z.number().int().min(0).optional(),
    notes:           z.string().max(400).optional().nullable(),
  }).optional(),
});

export const processPayrollSchema = z.object({ ...monthYear });

// ─── Leave ─────────────────────────────────────────────────────────────────

export const applyLeaveSchema = z.object({
  staffId:   z.string().min(1),
  leaveType: z.string().max(40).optional(),
  startDate: z.string().min(1),
  endDate:   z.string().min(1),
  reason:    z.string().max(400).optional().nullable(),
});

export const leaveStatusSchema = z.object({
  status:     z.enum(['APPROVED', 'REJECTED']),
  approvedBy: z.string().optional(),
});
