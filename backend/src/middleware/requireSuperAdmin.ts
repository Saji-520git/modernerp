import type { RequestHandler } from 'express';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { HttpError } from './error-handler.js';

/**
 * Restricts a route to BROcode Solutions staff (the super-admin).
 *
 * The client's own ADMIN role is NOT sufficient — the super-admin panel must be
 * invisible even to client admins. The JWT does not carry the email, so we look
 * the user up by id and compare against SUPER_ADMIN_EMAIL. Async, so errors are
 * forwarded via next() (Express 4 does not catch async throws).
 */
export const requireSuperAdmin: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.auth) throw new HttpError(401, 'Not authenticated');

    const superEmail = env.SUPER_ADMIN_EMAIL;
    if (!superEmail) throw new HttpError(403, 'Super-admin access is not configured');

    const user = await prisma.user.findUnique({
      where:  { id: req.auth.userId },
      select: { email: true },
    });

    if (!user || user.email.toLowerCase() !== superEmail.toLowerCase()) {
      throw new HttpError(403, 'Forbidden: super-admin only');
    }

    next();
  } catch (err) {
    next(err);
  }
};
