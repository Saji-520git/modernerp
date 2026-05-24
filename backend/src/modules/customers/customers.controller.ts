import type { RequestHandler } from 'express';
import { customersService } from './customers.service.js';
import { customerBodySchema, listCustomersSchema } from './customers.schema.js';

export const list: RequestHandler = async (req, res) => {
  const input = listCustomersSchema.parse(req.query);
  res.json(await customersService.list(input));
};

export const getOne: RequestHandler = async (req, res) => {
  res.json(await customersService.getOne(req.params.id));
};

export const create: RequestHandler = async (req, res) => {
  const input = customerBodySchema.parse(req.body);
  res.status(201).json(await customersService.create(input));
};

export const update: RequestHandler = async (req, res) => {
  const input = customerBodySchema.parse(req.body);
  res.json(await customersService.update(req.params.id, input));
};

export const toggleActive: RequestHandler = async (req, res) => {
  res.json(await customersService.toggleActive(req.params.id));
};
