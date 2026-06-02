import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireModule } from '../../middleware/requireModule.js';
import {
  getStaff, getStaffById, createStaff, updateStaff, deleteStaff,
  getAttendance, markAttendance, bulkMarkAttendance, getAttendanceSummary,
  getSalary, calculateSalary, processSalary, processPayroll,
  getLeaves, applyLeave, updateLeaveStatus,
  getAttendanceReport, getPayrollReport,
} from './hr.controller.js';

export const router: Router = Router();

// All HR routes require authentication and the 'hr' module flag.
router.use(requireAuth, requireModule('hr'));

// Staff
router.get('/staff', getStaff);
router.post('/staff', createStaff);
router.get('/staff/:id', getStaffById);
router.put('/staff/:id', updateStaff);
router.delete('/staff/:id', deleteStaff);

// Attendance
router.get('/attendance', getAttendance);
router.post('/attendance', markAttendance);
router.post('/attendance/bulk', bulkMarkAttendance);
router.get('/attendance/summary', getAttendanceSummary);

// Salary
router.get('/salary', getSalary);
router.post('/salary/calculate', calculateSalary);
router.post('/salary/process', processSalary);
router.post('/salary/payroll', processPayroll);

// Leave
router.get('/leave', getLeaves);
router.post('/leave', applyLeave);
router.put('/leave/:id/status', updateLeaveStatus);

// Reports
router.get('/reports/attendance', getAttendanceReport);
router.get('/reports/payroll', getPayrollReport);
