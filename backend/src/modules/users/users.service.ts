import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import { resolvePermissions, type Permission } from '../../config/permissions.js';
import type {
  CreateUserInput,
  UpdateUserInput,
  ChangePasswordInput,
  ListUsersInput,
  UpdatePermissionsInput,
} from './users.schema.js';

// ─── Safe user select (never expose passwordHash) ────────────────────────────

const SAFE_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  permissions: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SALT_ROUNDS = 12; // 2^12 = 4096 iterations — GPU-resistant, ~300 ms on modern CPU

// ─── Service ──────────────────────────────────────────────────────────────────

export const usersService = {
  // ── List users ─────────────────────────────────────────────────────────────

  list: async (input: ListUsersInput) => {
    const { search, role, isActive, page, pageSize } = input;

    const where = {
      ...(role && { role }),
      ...(isActive !== undefined && { isActive }),
      ...(search && {
        OR: [
          { fullName: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [total, data] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, page, pageSize, data };
  },

  // ── Get one user ───────────────────────────────────────────────────────────

  getOne: async (id: string) => {
    const user = await prisma.user.findUnique({ where: { id }, select: SAFE_SELECT });
    if (!user) throw new HttpError(404, 'User not found');
    return user;
  },

  // ── Create user ────────────────────────────────────────────────────────────

  create: async (input: CreateUserInput) => {
    // Check email uniqueness
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new HttpError(409, `Email "${input.email}" is already registered`);

    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

    // Store custom permissions only if they differ from role defaults
    const roleDefaults = resolvePermissions(input.role as Parameters<typeof resolvePermissions>[0], null);
    const customPerms =
      input.permissions && input.permissions.length > 0
        ? (JSON.stringify(input.permissions) !== JSON.stringify(roleDefaults) ? input.permissions : null)
        : null;

    return prisma.user.create({
      data: {
        fullName: input.fullName,
        email: input.email,
        passwordHash,
        role: input.role,
        permissions: customPerms ?? undefined,
        isActive: true,
      },
      select: SAFE_SELECT,
    });
  },

  // ── Update user (name, email, role) ────────────────────────────────────────

  update: async (id: string, input: UpdateUserInput, requesterId: string) => {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new HttpError(404, 'User not found');

    // Prevent changing own role (admin could accidentally demote themselves)
    if (id === requesterId && input.role !== user.role) {
      throw new HttpError(403, 'You cannot change your own role. Ask another admin.');
    }

    // Check email uniqueness (exclude current user)
    if (input.email !== user.email) {
      const emailTaken = await prisma.user.findUnique({ where: { email: input.email } });
      if (emailTaken) throw new HttpError(409, `Email "${input.email}" is already registered`);
    }

    // Store custom permissions if provided; if role changed and no custom perms, clear them
    let permissionsData: Permission[] | null | undefined = undefined;
    if (input.permissions !== undefined) {
      permissionsData = input.permissions ?? null;
    } else if (input.role !== user.role) {
      // Role changed without explicit permissions → clear custom overrides so new role defaults apply
      permissionsData = null;
    }

    // Build the permissions field for the update
    const permissionsField =
      permissionsData === undefined
        ? {} // no change
        : permissionsData === null
        ? { permissions: Prisma.DbNull } // clear to role defaults
        : { permissions: permissionsData }; // set custom array

    return prisma.user.update({
      where: { id },
      data: {
        fullName: input.fullName,
        email: input.email,
        role: input.role,
        ...permissionsField,
      },
      select: SAFE_SELECT,
    });
  },

  // ── Change password ────────────────────────────────────────────────────────

  changePassword: async (id: string, input: ChangePasswordInput) => {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new HttpError(404, 'User not found');

    const passwordHash = await bcrypt.hash(input.newPassword, SALT_ROUNDS);

    await prisma.user.update({
      where: { id },
      data: { passwordHash },
    });

    return { message: 'Password updated successfully' };
  },

  // ── Toggle active (deactivate / reactivate) ────────────────────────────────

  toggleActive: async (id: string, requesterId: string) => {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new HttpError(404, 'User not found');

    // Cannot deactivate yourself
    if (id === requesterId) {
      throw new HttpError(403, 'You cannot deactivate your own account');
    }

    // Cannot deactivate the last active admin (prevent full lockout)
    if (user.role === 'ADMIN' && user.isActive) {
      const activeAdminCount = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true },
      });
      if (activeAdminCount <= 1) {
        throw new HttpError(
          409,
          'Cannot deactivate the last active admin. Promote another admin first.',
        );
      }
    }

    return prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive },
      select: SAFE_SELECT,
    });
  },

  // ── Update permissions only ────────────────────────────────────────────────

  updatePermissions: async (id: string, input: UpdatePermissionsInput) => {
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new HttpError(404, 'User not found');

    return prisma.user.update({
      where: { id },
      // null = revert to role defaults (clear the Json column)
      // array = store custom overrides
      data: { permissions: input.permissions === null ? Prisma.DbNull : input.permissions },
      select: SAFE_SELECT,
    });
  },

  // ── Summary stats ──────────────────────────────────────────────────────────

  stats: async () => {
    const [total, active] = await prisma.$transaction([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
    ]);
    // groupBy requires orderBy in Prisma 5 — run separately to avoid $transaction typing issues
    const byRole = await prisma.user.groupBy({
      by: ['role'],
      _count: { _all: true },
      orderBy: { role: 'asc' },
    });
    return {
      total,
      active,
      inactive: total - active,
      byRole: Object.fromEntries(
        byRole.map((r) => [r.role, (r._count as { _all: number })._all]),
      ),
    };
  },
};
