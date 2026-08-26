import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { HttpError } from './error-handler.js';
import { expandPermissions, type Permission } from '../config/permissions.js';

export interface AuthPayload {
  userId: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'CASHIER' | 'STAFF';
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
    // Expanded at CHECK time, not at sign-in.
    //
    // The token carries the grants a user was given; a guard asks about an
    // effective action. Testing the raw list means a token minted before a
    // permission was split still names only the coarse key, so every finer
    // route refuses it — deploying a split would 403 every signed-in user
    // until they happened to log out and back in. Expansion is a short loop
    // and makes the age of the token irrelevant.
    const held = expandPermissions(req.auth.permissions as Permission[]);
    const missing = perms.filter((p) => !held.includes(p));
    if (missing.length > 0) throw new HttpError(403, 'Forbidden: missing permissions');
    next();
  };
