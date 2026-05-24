import 'dotenv/config';
import express from 'express';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

// ── Prevent unhandled promise rejections from crashing the server ──────────────
process.on('unhandledRejection', (reason) => {
  // Log it but DO NOT exit — tsx watch / pm2 would restart anyway, but mid-request crashes lose responses
  console.error('[unhandledRejection]', reason);
});
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFound } from './middleware/not-found.js';
import { router as apiRouter } from './modules/index.js';
import { inventoryService } from './modules/inventory/inventory.service.js';
import { productsService } from './modules/products/products.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ── Security headers ───────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '10mb' })); // base64 images need headroom
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── Rate limiting ──────────────────────────────────────────────────────────────
// Global: 300 requests / minute per IP
app.use(rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false }));

// Login: 10 attempts / 10 minutes per IP (brute-force protection)
const loginLimiter = rateLimit({
  windowMs: 10 * 60_000,   // 10 minutes
  max: 10,
  message: { error: 'TooManyRequests', message: 'Too many login attempts, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only count failed attempts
});
app.use('/api/v1/auth/login', loginLimiter);

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));
app.use('/api/v1', apiRouter);

// Serve React frontend
app.use(express.static(
  path.resolve(__dirname, '../../frontend/dist')
));

// React router fallback
app.get('*', (req, res, next) => {
  if (!req.path.startsWith('/api')) {
    return res.sendFile(
      path.resolve(__dirname, '../../frontend/dist/index.html')
    );
  }

  return next();
});

app.use(notFound);
app.use(errorHandler);

app.listen(env.PORT, async () => {
  logger.info(`ModernERP API listening on http://localhost:${env.PORT}`);

  if (process.env.NODE_ENV !== 'test') {
    // Remove phantom zero-qty stock records left by ensureStockRecords.
    // Safe to run every restart — idempotent, only deletes rows with no history.
    inventoryService.cleanupPhantomStock().catch((err: unknown) => logger.error(err, 'cleanupPhantomStock failed'));

    // Warn about stock records that have qty > 0 but no batch history and only OUT movements.
    // These may have inflated quantities from before FEFO batch tracking was introduced.
    // Owner must fix via Adjust Stock — we never silently alter stock numbers.
    inventoryService.warnInflatedStock().catch((err: unknown) => logger.error(err, 'warnInflatedStock failed'));

    // Fix any scientific-notation barcodes stored in DB (e.g. "7.57218E+11" → "757218000000").
    productsService.cleanupScientificBarcodes()
      .then((r: { fixed: number }) => {
        if (r.fixed > 0) logger.info({ fixed: r.fixed }, 'Fixed scientific-notation barcodes');
      })
      .catch((e: unknown) => logger.error(e, 'Barcode cleanup failed'));
  }
});
