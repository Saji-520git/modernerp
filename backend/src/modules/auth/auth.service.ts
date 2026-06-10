import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { HttpError } from '../../middleware/error-handler.js';
import { resolvePermissions, type Permission } from '../../config/permissions.js';
import type { LoginInput, RegisterInput } from './auth.schema.js';

function signTokens(userId: string, role: string, permissions: Permission[]) {
  const access = jwt.sign({ userId, role, permissions }, env.JWT_ACCESS_SECRET, {
    // v1.0.43 — fixed 24h so cashier sessions don't expire mid-shift (env default was '15m')
    expiresIn: '24h',
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const refresh = jwt.sign({ userId, role }, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_EXPIRES_IN as any,
  });
  return { access, refresh };
}

export const authService = {
  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user || !user.isActive) throw new HttpError(401, 'Invalid credentials');
    const ok = await bcrypt.compare(input.password, user.passwordHash);
    if (!ok) throw new HttpError(401, 'Invalid credentials');

    const permissions = resolvePermissions(user.role, user.permissions);
    const tokens = signTokens(user.id, user.role, permissions);

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
        permissions,
      },
      ...tokens,
    };
  },

  async register(input: RegisterInput) {
    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw new HttpError(409, 'Email already registered');
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await prisma.user.create({
      data: { email: input.email, fullName: input.fullName, passwordHash, role: 'STAFF' },
    });
    const permissions = resolvePermissions(user.role, user.permissions);
    const tokens = signTokens(user.id, user.role, permissions);
    return {
      user: { id: user.id, email: user.email, fullName: user.fullName, role: user.role, permissions },
      ...tokens,
    };
  },

  async me(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, fullName: true, role: true, permissions: true, createdAt: true },
    });
    if (!user) throw new HttpError(404, 'User not found');
    return {
      ...user,
      permissions: resolvePermissions(user.role, user.permissions),
    };
  },
};
