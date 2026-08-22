import type { Request, Response } from 'express';
import { z } from 'zod';
import { auditService } from './audit.service.js';

const listAuditSchema = z.object({
  search:   z.string().trim().optional(),
  entity:   z.string().trim().optional(),
  action:   z.string().trim().optional(),
  userId:   z.string().trim().optional(),
  entityId: z.string().trim().optional(),
  from:     z.string().trim().optional(),
  to:       z.string().trim().optional(),
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const auditController = {
  async list(req: Request, res: Response) {
    const input = listAuditSchema.parse(req.query);
    res.json(await auditService.list(input));
  },

  async facets(_req: Request, res: Response) {
    res.json(await auditService.facets());
  },

  async forEntity(req: Request, res: Response) {
    const { entity, entityId } = req.params;
    res.json(await auditService.forEntity(entity, entityId));
  },
};
