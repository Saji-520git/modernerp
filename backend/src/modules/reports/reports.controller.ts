import type { RequestHandler } from 'express';
import { z } from 'zod';
import { reportsService } from './reports.service.js';

// ─── Shared date-range schema ─────────────────────────────────────────────────

const dateRangeSchema = z.object({
  // "2026-05-14" → parse as UTC midnight, then extend to end-of-day in UTC
  // Using setHours (local time) caused the boundary to shift by the server
  // timezone offset, potentially cutting off same-day sales.
  from: z.string().transform((s) => new Date(s)),
  to: z.string().transform((s) => {
    const d = new Date(s);
    d.setUTCHours(23, 59, 59, 999);
    return d;
  }),
  groupBy: z.enum(['day', 'week', 'month']).optional().default('day'),
});

const blankToUndefined = z.string().trim().transform((v) => (v === '' ? undefined : v)).optional();

/** Narrow a sales report to one customer and/or warehouse. */
const salesScopeSchema = z.object({
  customerId:  blankToUndefined,
  warehouseId: blankToUndefined,
});

/** Narrow a purchases report to one supplier and/or warehouse. */
const purchaseScopeSchema = z.object({
  supplierId:  blankToUndefined,
  warehouseId: blankToUndefined,
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

export const salesReport: RequestHandler = async (req, res) => {
  const { from, to, groupBy } = dateRangeSchema.parse(req.query);
  const scope = salesScopeSchema.parse(req.query);
  res.json(await reportsService.salesReport(from, to, groupBy, scope));
};

export const salesCsv: RequestHandler = async (req, res) => {
  const { from, to, groupBy } = dateRangeSchema.parse(req.query);
  // The export must match what is on screen, scope included.
  const scope = salesScopeSchema.parse(req.query);
  const data = await reportsService.salesReport(from, to, groupBy, scope);
  const today = new Date().toISOString().slice(0, 10);
  const avgOrder = (row: { revenueCents: number; orders: number }) =>
    row.orders > 0 ? (row.revenueCents / row.orders / 100).toFixed(2) : '0.00';

  const lines = [
    'Period,Revenue (Rs.),Orders,Avg Order (Rs.)',
    ...data.byPeriod.map((r) =>
      `${r.period},${(r.revenueCents / 100).toFixed(2)},${r.orders},${avgOrder(r)}`,
    ),
  ];
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="sales-report-${today}.csv"`);
  res.send(lines.join('\r\n'));
};

export const purchasesReport: RequestHandler = async (req, res) => {
  const { from, to } = dateRangeSchema.parse(req.query);
  const scope = purchaseScopeSchema.parse(req.query);
  res.json(await reportsService.purchasesReport(from, to, scope));
};

export const productReport: RequestHandler = async (req, res) => {
  const { from, to } = dateRangeSchema.parse(req.query);
  res.json(await reportsService.productReport(from, to));
};

export const customerReport: RequestHandler = async (req, res) => {
  const { from, to } = dateRangeSchema.parse(req.query);
  res.json(await reportsService.customerReport(from, to));
};

export const inventoryReport: RequestHandler = async (req, res) => {
  const warehouseId = req.query.warehouseId as string | undefined;
  res.json(await reportsService.inventoryReport(warehouseId || undefined));
};

export const profitLoss: RequestHandler = async (req, res) => {
  const { from, to } = dateRangeSchema.parse(req.query);
  res.json(await reportsService.profitLoss(from, to));
};

export const pnlComparison: RequestHandler = async (req, res) => {
  const { dateFrom, dateTo, warehouseId } = req.query as Record<string, string>;
  if (!dateFrom || !dateTo) {
    res.status(400).json({ error: 'dateFrom and dateTo required' });
    return;
  }
  res.json(await reportsService.getPnlComparison(dateFrom, dateTo, warehouseId || undefined));
};

export const dashboardStats: RequestHandler = async (_req, res) => {
  res.json(await reportsService.getDashboardStats());
};

export const todaySummary: RequestHandler = async (_req, res) => {
  res.json(await reportsService.todaySummary());
};

