import { Router } from 'express';
import { router as authRouter } from './auth/auth.routes.js';
import { router as posRouter } from './pos/pos.routes.js';
import { router as productsRouter } from './products/products.routes.js';
import { router as inventoryRouter } from './inventory/inventory.routes.js';
import { router as purchasesRouter } from './purchases/purchases.routes.js';
import { router as suppliersRouter } from './suppliers/suppliers.routes.js';
import { router as customersRouter } from './customers/customers.routes.js';
import { router as salesRouter } from './sales/sales.routes.js';
import { router as usersRouter } from './users/users.routes.js';
import { router as dashboardRouter } from './dashboard/dashboard.routes.js';
import { router as reportsRouter } from './reports/reports.routes.js';
import { router as masterDataRouter } from './master-data/master-data.routes.js';
import { router as unitsRouter } from './units/units.routes.js';
import { router as expensesRouter } from './expenses/expenses.routes.js';
import { router as settingsRouter } from './settings/settings.routes.js';
import { router as warehousesRouter } from './warehouses/warehouses.routes.js';

export const router: Router = Router();

router.get('/', (_req, res) => res.json({ name: 'ModernERP API', version: 'v1' }));

router.use('/auth', authRouter);
router.use('/pos', posRouter);
router.use('/products', productsRouter);
router.use('/inventory', inventoryRouter);
router.use('/purchases', purchasesRouter);
router.use('/suppliers', suppliersRouter);
router.use('/customers', customersRouter);
router.use('/sales', salesRouter);
router.use('/users', usersRouter);
router.use('/dashboard', dashboardRouter);
router.use('/reports', reportsRouter);
router.use('/master-data', masterDataRouter);
router.use('/units',    unitsRouter);
router.use('/expenses', expensesRouter);
router.use('/settings',   settingsRouter);
router.use('/warehouses', warehousesRouter);
