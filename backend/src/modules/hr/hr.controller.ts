import type { RequestHandler } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { HttpError } from '../../middleware/error-handler.js';
import { hrService } from './hr.service.js';
import {
  createStaffSchema,
  updateStaffSchema,
  markAttendanceSchema,
  bulkAttendanceSchema,
  calculateSalarySchema,
  processSalarySchema,
  processPayrollSchema,
  applyLeaveSchema,
  leaveStatusSchema,
} from './hr.schema.js';

/** Parse a required positive integer query param. */
function intParam(value: unknown, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new HttpError(400, `Invalid or missing "${name}"`);
  return n;
}

// ─── Staff ─────────────────────────────────────────────────────────────────

export const getStaff: RequestHandler = asyncHandler(async (req, res) => {
  const { isActive, department, search } = req.query;
  const filters = {
    isActive:   isActive === undefined ? undefined : isActive === 'true',
    department: typeof department === 'string' && department ? department : undefined,
    search:     typeof search === 'string' && search ? search : undefined,
  };
  const data = await hrService.getAllStaff(filters);
  res.json({ success: true, data, message: 'ok' });
});

export const getStaffById: RequestHandler = asyncHandler(async (req, res) => {
  const data = await hrService.getStaffById(req.params.id);
  res.json({ success: true, data, message: 'ok' });
});

export const createStaff: RequestHandler = asyncHandler(async (req, res) => {
  const input = createStaffSchema.parse(req.body);
  const data = await hrService.createStaff(input);
  res.status(201).json({ success: true, data, message: 'Staff created' });
});

export const updateStaff: RequestHandler = asyncHandler(async (req, res) => {
  const input = updateStaffSchema.parse(req.body);
  const data = await hrService.updateStaff(req.params.id, input);
  res.json({ success: true, data, message: 'Staff updated' });
});

export const deleteStaff: RequestHandler = asyncHandler(async (req, res) => {
  const data = await hrService.deleteStaff(req.params.id);
  res.json({ success: true, data, message: 'Staff deleted' });
});

// ─── Attendance ──────────────────────────────────────────────────────────────

export const getAttendance: RequestHandler = asyncHandler(async (req, res) => {
  const staffId = String(req.query.staffId ?? '');
  if (!staffId) throw new HttpError(400, 'staffId is required');
  const month = intParam(req.query.month, 'month');
  const year = intParam(req.query.year, 'year');
  const data = await hrService.getAttendance(staffId, month, year);
  res.json({ success: true, data, message: 'ok' });
});

export const markAttendance: RequestHandler = asyncHandler(async (req, res) => {
  const input = markAttendanceSchema.parse(req.body);
  const data = await hrService.markAttendance(input);
  res.json({ success: true, data, message: 'Attendance saved' });
});

export const bulkMarkAttendance: RequestHandler = asyncHandler(async (req, res) => {
  const { date, records } = bulkAttendanceSchema.parse(req.body);
  const data = await hrService.bulkMarkAttendance(date, records.map((r) => ({ ...r, date })));
  res.json({ success: true, data, message: 'Attendance saved' });
});

export const getAttendanceSummary: RequestHandler = asyncHandler(async (req, res) => {
  const month = intParam(req.query.month, 'month');
  const year = intParam(req.query.year, 'year');
  const data = await hrService.getAttendanceSummary(month, year);
  res.json({ success: true, data, message: 'ok' });
});

// ─── Salary ────────────────────────────────────────────────────────────────

export const getSalary: RequestHandler = asyncHandler(async (req, res) => {
  const month = intParam(req.query.month, 'month');
  const year = intParam(req.query.year, 'year');
  const data = await hrService.getMonthlySalary(month, year);
  res.json({ success: true, data, message: 'ok' });
});

export const calculateSalary: RequestHandler = asyncHandler(async (req, res) => {
  const { staffId, month, year } = calculateSalarySchema.parse(req.body);
  const data = await hrService.calculateSalary(staffId, month, year);
  res.json({ success: true, data, message: 'ok' });
});

export const processSalary: RequestHandler = asyncHandler(async (req, res) => {
  const { staffId, month, year, adjustments } = processSalarySchema.parse(req.body);
  const data = await hrService.processSalary(staffId, month, year, adjustments);
  res.json({ success: true, data, message: 'Salary processed' });
});

export const processPayroll: RequestHandler = asyncHandler(async (req, res) => {
  const { month, year } = processPayrollSchema.parse(req.body);
  const data = await hrService.processPayroll(month, year);
  res.json({ success: true, data, message: 'Payroll processed' });
});

// ─── Leave ─────────────────────────────────────────────────────────────────

export const getLeaves: RequestHandler = asyncHandler(async (req, res) => {
  const { staffId, status, year } = req.query;
  const filters = {
    staffId: typeof staffId === 'string' && staffId ? staffId : undefined,
    status:  typeof status === 'string' && status ? status : undefined,
    year:    year !== undefined ? intParam(year, 'year') : undefined,
  };
  const data = await hrService.getLeaves(filters);
  res.json({ success: true, data, message: 'ok' });
});

export const applyLeave: RequestHandler = asyncHandler(async (req, res) => {
  const input = applyLeaveSchema.parse(req.body);
  const data = await hrService.applyLeave(input);
  res.status(201).json({ success: true, data, message: 'Leave applied' });
});

export const updateLeaveStatus: RequestHandler = asyncHandler(async (req, res) => {
  const { status, approvedBy } = leaveStatusSchema.parse(req.body);
  const approver = approvedBy ?? req.auth?.userId;
  if (!approver) throw new HttpError(400, 'approvedBy is required');
  const data = await hrService.updateLeaveStatus(req.params.id, status, approver);
  res.json({ success: true, data, message: `Leave ${status.toLowerCase()}` });
});

// ─── Reports ─────────────────────────────────────────────────────────────────

export const getAttendanceReport: RequestHandler = asyncHandler(async (req, res) => {
  const month = intParam(req.query.month, 'month');
  const year = intParam(req.query.year, 'year');
  const data = await hrService.getAttendanceReport(month, year);
  res.json({ success: true, data, message: 'ok' });
});

export const getPayrollReport: RequestHandler = asyncHandler(async (req, res) => {
  const month = intParam(req.query.month, 'month');
  const year = intParam(req.query.year, 'year');
  const data = await hrService.getPayrollReport(month, year);
  res.json({ success: true, data, message: 'ok' });
});
