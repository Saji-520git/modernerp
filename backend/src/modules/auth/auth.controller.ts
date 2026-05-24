import type { RequestHandler } from 'express';
import { authService } from './auth.service.js';
import { loginSchema, registerSchema } from './auth.schema.js';
import { HttpError } from '../../middleware/error-handler.js';

export const login: RequestHandler = async (req, res) => {
  const data = loginSchema.parse(req.body);
  const result = await authService.login(data);
  res.json(result);
};

export const register: RequestHandler = async (req, res) => {
  const data = registerSchema.parse(req.body);
  const result = await authService.register(data);
  res.status(201).json(result);
};

export const me: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const user = await authService.me(req.auth.userId);
  res.json(user);
};
