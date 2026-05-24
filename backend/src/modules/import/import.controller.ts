import type { RequestHandler } from 'express';
import {
  parseProductsFile,
  validateAgainstDb,
  importProducts,
} from './import.service.js';
import { HttpError } from '../../middleware/error-handler.js';

// POST /api/v1/import/preview
// Parses the uploaded file and returns { valid[], errors[] } without writing anything.
export const preview: RequestHandler = async (req, res) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new HttpError(400, 'No file uploaded. Send a multipart/form-data request with field "file".');

  const result  = parseProductsFile(file.buffer, file.mimetype);
  const dbErrors = result.valid.length > 0
    ? await validateAgainstDb(result.valid)
    : [];

  // Move DB-conflict rows from valid → errors
  if (dbErrors.length > 0) {
    const errorRows = new Set(dbErrors.map((e) => e.row));
    const stillValid = result.valid.filter((r) => !errorRows.has(r.rowNum));
    result.errors.push(...dbErrors);
    return res.json({ valid: stillValid, errors: result.errors });
  }

  res.json(result);
};

// POST /api/v1/import/confirm
// Parses, validates, then imports. Returns summary.
export const confirm: RequestHandler = async (req, res) => {
  const file = (req as any).file as Express.Multer.File | undefined;
  if (!file) throw new HttpError(400, 'No file uploaded.');

  const result   = parseProductsFile(file.buffer, file.mimetype);
  const dbErrors = result.valid.length > 0
    ? await validateAgainstDb(result.valid)
    : [];

  if (result.errors.length > 0 || dbErrors.length > 0) {
    throw new HttpError(422, 'File has validation errors — run /preview first and fix all errors before confirming.', {
      parseErrors: result.errors,
      dbErrors,
    });
  }

  if (result.valid.length === 0) {
    throw new HttpError(400, 'No valid rows to import.');
  }

  const summary = await importProducts(result.valid, req.auth!.userId);
  res.status(201).json(summary);
};
