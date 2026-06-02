import { Router } from 'express';
import { router as configRouter } from './config/config.routes.js';

// v2 API aggregator — mounted at /api/v2. New v2 modules register here.
export const router: Router = Router();

router.get('/', (_req, res) => res.json({ name: 'BROcode ERP API', version: 'v2' }));

router.use('/config', configRouter);
