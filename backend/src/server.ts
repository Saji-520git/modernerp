import 'dotenv/config';
import fs from 'fs';
import express from 'express';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

// Ensure uploads directory exists before any request is served
const uploadsDir = process.env.UPLOAD_PATH ?? path.resolve('uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

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
import { auditTrail } from './middleware/audit.js';
import { prisma } from './config/prisma.js';
import { inventoryService } from './modules/inventory/inventory.service.js';
import { productsService } from './modules/products/products.service.js';
import { seedDefaultUnitsIfEmpty } from './utils/default-units.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ── Security headers ───────────────────────────────────────────────────────────
app.use(helmet());
// CORS_ORIGIN accepts a comma-separated list, or '*' meaning "reflect whatever
// origin asked".
//
// One backend serves two very different callers. In development the renderer is
// http://localhost:5173. In the packaged desktop app it is loaded with
// loadFile(), so the page origin is file:// — sent as `Origin: null`, which can
// never match a fixed http:// value. A mismatch there blocked every API
// response and reached the cashier as "Cannot reach the server", because a
// browser reports a blocked cross-origin request as a network failure.
//
// A literal '*' cannot be handed to cors() here: the app sends credentials, and
// browsers refuse a wildcard on credentialed requests. Reflecting the origin is
// the supported equivalent, and safe for this server — it binds to localhost
// and ships inside the desktop app.
const corsOrigins = env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean);
app.use(cors({
  origin: corsOrigins.includes('*') ? true : corsOrigins,
  credentials: true,
}));
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

// Authenticated file download — replaces open express.static('/uploads').
// Checks for Bearer token in Authorization header before serving the file.
// path.basename strips any directory-traversal attempts (e.g. "../../etc/passwd").
app.get('/uploads/:filename', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  const filename = path.basename(req.params.filename);
  const filePath = path.join(uploadsDir, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }
  res.sendFile(filePath);
});

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// API responses must never be served from the browser's HTTP cache — TanStack
// Query already owns application-level caching. Without this, a long-idle tab
// can replay a stale response (e.g. a stale "today" figure) on next fetch.
app.use('/api/v1', (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
// Records every state-changing API request. Mounted here, ahead of the router,
// so it covers routes that do not exist yet as well as the ones that do —
// see middleware/audit.ts for what is and is not recorded.
app.use('/api/v1', auditTrail);
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
  logger.info(`BROcode ERP API listening on http://localhost:${env.PORT}`);

  // Warm up the Prisma query engine NOW (during the splash screen) instead of
  // lazily on the first request. Prisma loads its ~15 MB native engine binary
  // and opens the DB connection on first query — on a clean PC with on-access
  // antivirus (e.g. McAfee) scanning that binary, the cold start can stall for
  // minutes. Doing it here means login's first query is already warm and instant.
  if (process.env.NODE_ENV !== 'test') {
    prisma.$connect()
      .then(() => logger.info('Prisma connected to database (engine warm)'))
      .catch((e: unknown) => logger.error(e, 'Prisma initial $connect failed'));
  }

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

    // Fresh-install safety net: a brand new DB (migrate deploy only, no dev
    // seed) has zero units, which blocks product creation entirely. Only
    // fires when the table is truly empty — never touches a client's units.
    seedDefaultUnitsIfEmpty(prisma)
      .then((seeded: number) => {
        if (seeded > 0) logger.info({ seeded }, 'Seeded default starter units (fresh install)');
      })
      .catch((e: unknown) => logger.error(e, 'Default unit seed failed'));
  }
});
