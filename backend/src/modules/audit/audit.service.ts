import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';

export interface ListAuditInput {
  search?:   string;
  entity?:   string;
  action?:   string;
  userId?:   string;
  entityId?: string;
  from?:     string;
  to?:       string;
  page:      number;
  pageSize:  number;
}

export const auditService = {
  /**
   * Newest first, filtered. Read-only by design: there is no update and no
   * delete anywhere in this service, and none should be added. A trail that
   * can be edited answers no question worth asking.
   */
  async list(input: ListAuditInput) {
    const { search, entity, action, userId, entityId, from, to, page, pageSize } = input;

    const where: Prisma.AuditLogWhereInput = {
      ...(entity   ? { entity }   : {}),
      ...(action   ? { action }   : {}),
      ...(userId   ? { userId }   : {}),
      ...(entityId ? { entityId } : {}),
      ...(from || to
        ? {
            at: {
              ...(from ? { gte: new Date(from) } : {}),
              // `to` is a date, and a day includes its last second.
              ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { userName: { contains: search, mode: 'insensitive' } },
              { summary:  { contains: search, mode: 'insensitive' } },
              { path:     { contains: search, mode: 'insensitive' } },
              { entityId: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, data] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return { total, page, pageSize, data };
  },

  /** Distinct entities and actions present, so the UI filters offer only what exists. */
  async facets() {
    const [entities, actions, users] = await Promise.all([
      prisma.auditLog.findMany({ distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
      prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
      prisma.auditLog.findMany({
        distinct: ['userId'],
        select: { userId: true, userName: true },
        orderBy: { userName: 'asc' },
        where: { userId: { not: null } },
      }),
    ]);
    return {
      entities: entities.map((e) => e.entity),
      actions:  actions.map((a) => a.action),
      users:    users.map((u) => ({ id: u.userId as string, name: u.userName })),
    };
  },

  /** Everything that ever happened to one record — the "why does this invoice say that" view. */
  async forEntity(entity: string, entityId: string) {
    return prisma.auditLog.findMany({
      where:   { entity, entityId },
      orderBy: { at: 'desc' },
      take:    200,
    });
  },
};
