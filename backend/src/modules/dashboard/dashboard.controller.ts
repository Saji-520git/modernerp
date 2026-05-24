import type { RequestHandler } from 'express';
import { dashboardService } from './dashboard.service.js';

export const summary: RequestHandler = async (_req, res) => {
  res.json(await dashboardService.summary());
};

export const revenueChart: RequestHandler = async (req, res) => {
  const raw  = Number(req.query.days ?? 30);
  const days = ([30, 60, 90] as const).includes(raw as 30 | 60 | 90)
    ? (raw as 30 | 60 | 90)
    : 30;
  res.json(await dashboardService.revenueChart(days));
};
