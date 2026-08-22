import type { RequestHandler } from 'express';
import { prisma } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import {
  redact, entityOf, entityIdOf, actionOf, shouldRecord, MAX_META_CHARS,
} from './audit-rules.js';

// ─── Audit trail ──────────────────────────────────────────────────────────────
//
// One middleware rather than a call in each service. Per-service logging gets
// forgotten exactly where it matters most — the rushed fix, the new endpoint,
// the path someone added last week — and a trail with holes in it is worse than
// no trail, because it invites the conclusion that nothing happened.
//
// Sitting on the request means every state-changing route is covered the moment
// it exists, including the ones not written yet.
//
// What is and is not recorded lives in audit-rules.ts, which is pure and tested.

/**
 * The JWT carries userId, role and permissions — not the name. Rather than
 * widen the token (which would leave every already-issued one without it), the
 * name is resolved once per user and kept.
 *
 * Bounded: one short string per user who has acted since the process started.
 * Goes stale only if someone is renamed mid-session, and the rows already
 * written were correct when written — which is the whole point of storing the
 * name rather than joining to it.
 */
const nameCache = new Map<string, string>();

async function actorName(userId: string | undefined): Promise<string> {
  if (!userId) return 'anonymous';
  const hit = nameCache.get(userId);
  if (hit) return hit;
  const user = await prisma.user
    .findUnique({ where: { id: userId }, select: { fullName: true } })
    .catch(() => null);
  const name = user?.fullName ?? userId;
  nameCache.set(userId, name);
  return name;
}

export const auditTrail: RequestHandler = (req, res, next) => {
  const method = req.method.toUpperCase();

  // Cheap pre-filter so a read never pays for any of this. The real decision is
  // made on `finish`, once the status is known.
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

  // Captured up-front: a handler is free to mutate req.body, and the trail must
  // show what was sent, not what survived.
  const body = redact(req.body);

  res.on('finish', () => {
    if (!shouldRecord(method, req.path, res.statusCode)) return;

    const auth   = req.auth;
    const entity = entityOf(req.path);
    const action = actionOf(method, req.path);

    let metaText = '';
    try { metaText = JSON.stringify(body); } catch { metaText = ''; }

    // Deliberately not awaited: the response has already gone out, and the
    // request must never be slowed or failed by the trail — the sale already
    // happened. Logged loudly on failure so a broken trail is never silent.
    void actorName(auth?.userId)
      .then((userName) =>
        prisma.auditLog.create({
          data: {
            userId:   auth?.userId ?? null,
            userName,
            userRole: auth?.role ?? 'ANONYMOUS',
            action,
            entity,
            entityId: entityIdOf(req.path),
            summary:  `${action} ${entity}${res.statusCode >= 500 ? ' (failed)' : ''}`,
            method,
            path:     req.originalUrl.split('?')[0],
            status:   res.statusCode,
            ip:       req.ip ?? null,
            meta:     metaText && metaText.length <= MAX_META_CHARS
                        ? (body as object)
                        : undefined,
          },
        }),
      )
      .catch((err) => {
        logger.error({ err, path: req.path }, 'audit trail write failed');
      });
  });

  next();
};
