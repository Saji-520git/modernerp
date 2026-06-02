/// <reference types="vite/client" />
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import type {
  Staff, StaffDetail, CreateStaffDto, UpdateStaffDto,
  Attendance, AttendanceResult, MarkAttendanceDto, AttendanceSummary,
  Salary, SalaryCalc, SalaryAdjustments, PayrollResult,
  Leave, ApplyLeaveDto, LeaveStatus,
  AttendanceReportRow, PayrollReport,
} from '../types/hr';

// HR lives under /api/v2 — derive a v2 base from the same env var as the v1 api.
const v1Base = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';
const v2Base = v1Base.replace('/api/v1', '/api/v2');

const v2 = axios.create({ baseURL: v2Base });

v2.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

v2.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) useAuthStore.getState().logout();
    return Promise.reject(err);
  },
);

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message: string;
}

const unwrap = <T>(p: Promise<{ data: ApiEnvelope<T> }>): Promise<T> => p.then((r) => r.data.data);

export const hrService = {
  // ── Staff ──
  getAllStaff: (filters?: { isActive?: boolean; department?: string; search?: string }): Promise<Staff[]> =>
    unwrap<Staff[]>(v2.get('/hr/staff', { params: filters })),

  getStaffById: (id: string): Promise<StaffDetail> =>
    unwrap<StaffDetail>(v2.get(`/hr/staff/${id}`)),

  createStaff: (data: CreateStaffDto): Promise<Staff> =>
    unwrap<Staff>(v2.post('/hr/staff', data)),

  updateStaff: (id: string, data: UpdateStaffDto): Promise<Staff> =>
    unwrap<Staff>(v2.put(`/hr/staff/${id}`, data)),

  deleteStaff: (id: string): Promise<Staff> =>
    unwrap<Staff>(v2.delete(`/hr/staff/${id}`)),

  // ── Attendance ──
  getAttendance: (staffId: string, month: number, year: number): Promise<AttendanceResult> =>
    unwrap<AttendanceResult>(v2.get('/hr/attendance', { params: { staffId, month, year } })),

  markAttendance: (data: MarkAttendanceDto): Promise<Attendance> =>
    unwrap<Attendance>(v2.post('/hr/attendance', data)),

  bulkMarkAttendance: (date: string, records: MarkAttendanceDto[]): Promise<{ saved: number }> =>
    unwrap<{ saved: number }>(v2.post('/hr/attendance/bulk', { date, records })),

  getAttendanceSummary: (month: number, year: number): Promise<AttendanceSummary[]> =>
    unwrap<AttendanceSummary[]>(v2.get('/hr/attendance/summary', { params: { month, year } })),

  // ── Salary ──
  getMonthlySalary: (month: number, year: number): Promise<Salary[]> =>
    unwrap<Salary[]>(v2.get('/hr/salary', { params: { month, year } })),

  calculateSalary: (staffId: string, month: number, year: number): Promise<SalaryCalc> =>
    unwrap<SalaryCalc>(v2.post('/hr/salary/calculate', { staffId, month, year })),

  processSalary: (staffId: string, month: number, year: number, adjustments?: SalaryAdjustments): Promise<Salary> =>
    unwrap<Salary>(v2.post('/hr/salary/process', { staffId, month, year, adjustments })),

  processPayroll: (month: number, year: number): Promise<PayrollResult> =>
    unwrap<PayrollResult>(v2.post('/hr/salary/payroll', { month, year })),

  // ── Leave ──
  getLeaves: (filters?: { staffId?: string; status?: string; year?: number }): Promise<Leave[]> =>
    unwrap<Leave[]>(v2.get('/hr/leave', { params: filters })),

  applyLeave: (data: ApplyLeaveDto): Promise<Leave> =>
    unwrap<Leave>(v2.post('/hr/leave', data)),

  updateLeaveStatus: (id: string, status: Extract<LeaveStatus, 'APPROVED' | 'REJECTED'>, approvedBy?: string): Promise<Leave> =>
    unwrap<Leave>(v2.put(`/hr/leave/${id}/status`, { status, approvedBy })),

  // ── Reports ──
  getAttendanceReport: (month: number, year: number): Promise<AttendanceReportRow[]> =>
    unwrap<AttendanceReportRow[]>(v2.get('/hr/reports/attendance', { params: { month, year } })),

  getPayrollReport: (month: number, year: number): Promise<PayrollReport> =>
    unwrap<PayrollReport>(v2.get('/hr/reports/payroll', { params: { month, year } })),
};

// ─── Money helpers (integer cents) ───────────────────────────────────────────

/** Format integer cents as "Rs. 1,234.00". */
export function formatCents(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Parse a rupee input string into integer cents. */
export function rupeesToCents(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** Convert integer cents to a plain rupee string for an input field (no symbol). */
export function centsToRupees(cents: number): string {
  return (cents / 100).toFixed(2);
}
