// HR module shared types. Money fields are integer cents; dates are ISO strings.

export type EmploymentType = 'FULL_TIME' | 'PART_TIME' | 'CONTRACT' | 'DAILY';
export type SalaryType = 'MONTHLY' | 'DAILY' | 'HOURLY';
export type AttendanceStatus = 'PRESENT' | 'ABSENT' | 'LATE' | 'HALF_DAY' | 'LEAVE';
export type LeaveType = 'ANNUAL' | 'SICK' | 'CASUAL' | 'MATERNITY' | 'UNPAID' | 'OTHER';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type SalaryStatus = 'PENDING' | 'PAID';

export interface Staff {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  designation: string | null;
  department: string | null;
  employmentType: string;
  joinDate: string;
  salaryType: string;
  basicSalaryCents: number;
  isActive: boolean;
  deletedAt: string | null;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Attendance {
  id: string;
  staffId: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Salary {
  id: string;
  staffId: string;
  month: number;
  year: number;
  basicCents: number;
  allowancesCents: number;
  deductionsCents: number;
  netCents: number;
  status: string;
  paidAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  staff?: { fullName: string; designation: string | null; department: string | null; employeeId: string };
}

export interface Leave {
  id: string;
  staffId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  staff?: { fullName: string; employeeId: string; department: string | null };
}

export interface StaffDetail extends Staff {
  attendances: Attendance[];
  salaries: Salary[];
  leaves: Leave[];
}

// ─── DTOs ──────────────────────────────────────────────────────────────────

export interface CreateStaffDto {
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  designation?: string | null;
  department?: string | null;
  employmentType?: string;
  joinDate: string;
  salaryType?: string;
  basicSalaryCents?: number;
  userId?: string | null;
}

export type UpdateStaffDto = Partial<CreateStaffDto>;

export interface MarkAttendanceDto {
  staffId: string;
  date: string;
  status?: AttendanceStatus;
  clockIn?: string | null;
  clockOut?: string | null;
  notes?: string | null;
}

export interface ApplyLeaveDto {
  staffId: string;
  leaveType?: string;
  startDate: string;
  endDate: string;
  reason?: string | null;
}

export interface SalaryAdjustments {
  allowancesCents?: number;
  deductionsCents?: number;
  notes?: string | null;
}

// ─── Computed / summary shapes ───────────────────────────────────────────────

export interface AttendanceCounts {
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  leave: number;
}

export interface AttendanceResult {
  records: Attendance[];
  summary: AttendanceCounts;
}

export interface AttendanceSummary extends AttendanceCounts {
  staffId: string;
  employeeId: string;
  fullName: string;
  department: string | null;
}

export interface SalaryCalc {
  staffId: string;
  fullName: string;
  designation: string | null;
  month: number;
  year: number;
  workingDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  leaveDays: number;
  perDayCents: number;
  basicCents: number;
  allowancesCents: number;
  deductionsCents: number;
  netCents: number;
}

export interface PayrollResult {
  processed: number;
  skipped: number;
  totalStaff: number;
  totalPaidCents: number;
}

export interface AttendanceReportRow extends AttendanceCounts {
  staffId: string;
  employeeId: string;
  fullName: string;
  department: string | null;
  totalDays: number;
  attendancePct: number;
}

export interface PayrollTotals {
  basicCents: number;
  allowancesCents: number;
  deductionsCents: number;
  netCents: number;
}

export interface PayrollReport {
  rows: Salary[];
  departmentTotals: Record<string, PayrollTotals>;
  grandTotal: PayrollTotals;
}
