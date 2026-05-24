import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from './error-handler.js';
import type { Permission } from '../config/permissions.js';

export interface AuthPayload {
  userId: string;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER' | 'STAFF';
  permissions: Permission[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Missing token');
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AuthPayload;
    // Back-compat: old tokens without permissions fall back to empty array
    if (!payload.permissions) payload.permissions = [];
    req.auth = payload;
    next();
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
};

/** Require the user's JWT role to be one of the listed roles (coarse-grained) */
export const requireRole = (...roles: AuthPayload['role'][]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) throw new HttpError(401, 'Not authenticated');
    if (!roles.includes(req.auth.role)) throw new HttpError(403, 'Forbidden');
    next();
  };

/** Require ALL listed permissions to be present in the user's effective permission set */
export const requirePermission = (...perms: Permission[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) throw new HttpError(401, 'Not authenticated');
    const missing = perms.filter((p) => !req.auth!.permissions.includes(p));
    if (missing.length > 0) throw new HttpError(403, 'Forbidden: missing permissions');
    next();
  };
