import type { RequestHandler } from 'express';
import { usersService } from './users.service.js';
import {
  createUserSchema,
  updateUserSchema,
  changePasswordSchema,
  listUsersSchema,
  updatePermissionsSchema,
} from './users.schema.js';
import { HttpError } from '../../middleware/error-handler.js';

export const stats: RequestHandler = async (_req, res) => {
  res.json(await usersService.stats());
};

export const list: RequestHandler = async (req, res) => {
  const input = listUsersSchema.parse(req.query);
  res.json(await usersService.list(input));
};

export const getOne: RequestHandler = async (req, res) => {
  res.json(await usersService.getOne(req.params.id));
};

export const create: RequestHandler = async (req, res) => {
  const input = createUserSchema.parse(req.body);
  res.status(201).json(await usersService.create(input));
};

export const update: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = updateUserSchema.parse(req.body);
  res.json(await usersService.update(req.params.id, input, req.auth.userId));
};

export const changePassword: RequestHandler = async (req, res) => {
  const input = changePasswordSchema.parse(req.body);
  res.json(await usersService.changePassword(req.params.id, input));
};

export const toggleActive: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  res.json(await usersService.toggleActive(req.params.id, req.auth.userId));
};

export const updatePermissions: RequestHandler = async (req, res) => {
  const input = updatePermissionsSchema.parse(req.body);
  res.json(await usersService.updatePermissions(req.params.id, input));
};
