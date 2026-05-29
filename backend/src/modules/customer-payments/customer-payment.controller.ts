import type { RequestHandler } from 'express';
import { customerPaymentService } from './customer-payment.service.js';
import { HttpError } from '../../middleware/error-handler.js';

// ─── POST /customer-payments ──────────────────────────────────────────────────

export const createCustomerPayment: RequestHandler = async (req, res) => {
  const { saleId, amountCents, paymentMethod, referenceNo, bankName,
          paymentDate, notes } = req.body as {
    saleId:        string;
    amountCents:   number;
    paymentMethod: string;
    referenceNo?:  string;
    bankName?:     string;
    paymentDate:   string;
    notes?:        string;
  };

  if (!saleId)        throw new HttpError(400, 'saleId is required');
  if (!amountCents)   throw new HttpError(400, 'amountCents is required');
  if (!paymentMethod) throw new HttpError(400, 'paymentMethod is required');
  if (!paymentDate)   throw new HttpError(400, 'paymentDate is required');

  const payment = await customerPaymentService.createPayment({
    saleId,
    amountCents: Number(amountCents),
    paymentMethod,
    referenceNo,
    bankName,
    paymentDate,
    notes,
    createdBy: req.auth!.userId,
  });

  res.status(201).json(payment);
};

// ─── GET /customer-payments/sale/:saleId ──────────────────────────────────────

export const listCustomerPayments: RequestHandler = async (req, res) => {
  const items = await customerPaymentService.listBySale(req.params.saleId);
  res.json(items);
};

// ─── GET /customer-payments/customer/:customerId ─────────────────────────────

export const listPaymentsByCustomer: RequestHandler = async (req, res) => {
  const items = await customerPaymentService.listByCustomer(req.params.customerId);
  res.json(items);
};

// ─── DELETE /customer-payments/:id ────────────────────────────────────────────

export const voidCustomerPayment: RequestHandler = async (req, res) => {
  const result = await customerPaymentService.voidPayment(req.params.id);
  res.json(result);
};
