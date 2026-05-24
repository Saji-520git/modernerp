import { Router } from 'express';
import * as ctrl from './expenses.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';

export const router: Router = Router();

router.use(h(requireAuth));

router.get('/categories',        h(ctrl.listCategories));
router.post('/categories',       h(ctrl.createCategory));
router.patch('/categories/:id',  h(ctrl.updateCategory));
router.delete('/categories/:id', h(ctrl.deleteCategory));
router.get('/summary',           h(ctrl.getMonthlySummary));
router.get('/recurring',            h(ctrl.getRecurringDue));
router.delete('/recurring/:id',     h(ctrl.deleteRecurringTemplate));
router.get('/',                     h(ctrl.listExpenses));
router.post('/',                 h(ctrl.createExpense));
router.patch('/:id',             h(ctrl.updateExpense));
router.delete('/:id',            h(ctrl.deleteExpense));
