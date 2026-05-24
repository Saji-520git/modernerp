import type { RequestHandler } from 'express';
import { expensesService } from './expenses.service.js';
import {
  createExpenseSchema, updateExpenseSchema,
  listExpensesSchema, createCategorySchema, updateCategorySchema,
} from './expenses.schema.js';
import { HttpError } from '../../middleware/error-handler.js';

export const listCategories: RequestHandler = async (_req, res) => {
  res.json(await expensesService.listCategories());
};

export const createCategory: RequestHandler = async (req, res) => {
  const input = createCategorySchema.parse(req.body);
  res.status(201).json(await expensesService.createCategory(input));
};

export const updateCategory: RequestHandler = async (req, res) => {
  const input = updateCategorySchema.parse(req.body);
  res.json(await expensesService.updateCategory(req.params.id, input));
};

export const deleteCategory: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  res.json(await expensesService.deleteCategory(req.params.id, req.auth.userId));
};

export const listExpenses: RequestHandler = async (req, res) => {
  const input = listExpensesSchema.parse(req.query);
  res.json(await expensesService.listExpenses(input));
};

export const createExpense: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = createExpenseSchema.parse(req.body);
  res.status(201).json(await expensesService.createExpense(input, req.auth.userId));
};

export const updateExpense: RequestHandler = async (req, res) => {
  const input = updateExpenseSchema.parse(req.body);
  res.json(await expensesService.updateExpense(req.params.id, input));
};

export const deleteExpense: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  res.json(await expensesService.deleteExpense(req.params.id, req.auth.userId));
};

export const getRecurringDue: RequestHandler = async (_req, res) => {
  res.json(await expensesService.getRecurringDue());
};

export const deleteRecurringTemplate: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  await expensesService.deleteRecurringTemplate(req.params.id, req.auth.userId);
  res.status(204).send();
};

export const getMonthlySummary: RequestHandler = async (req, res) => {
  const year  = req.query.year  ? Number(req.query.year)  : undefined;
  const month = req.query.month ? Number(req.query.month) : undefined;
  res.json(await expensesService.getMonthlySummary(year, month));
};
