import type { RequestHandler } from 'express';
import { z } from 'zod';
import { supplierPaymentService } from './supplier-payment.service.js';
import type { PaymentMethod } from '@prisma/client';

const receiveCreditSchema = z.object({
  purchaseId:  z.string().min(1),
  supplierId:  z.string().min(1),
  amountCents: z.number().int().positive(),
  method:      z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'QR_PAY', 'CREDIT', 'CHEQUE']),
  reference:   z.string().optional(),
  date:        z.string().min(1),
  notes:       z.string().optional(),
});

export const createPayment: RequestHandler = async (req, res) => {
  const userId = req.auth!.userId;
  const payment = await supplierPaymentService.createPayment(
    {
      purchaseId:    req.body.purchaseId,
      amountCents:   Number(req.body.amountCents),
      paymentMethod: req.body.paymentMethod as PaymentMethod,
      referenceNo:   req.body.referenceNo,
      bankName:      req.body.bankName,
      paymentDate:   req.body.paymentDate,
      notes:         req.body.notes,
    },
    userId,
  );
  res.status(201).json(payment);
};

export const createLumpSumPayment: RequestHandler = async (req, res) => {
  const userId = req.auth!.userId;
  const result = await supplierPaymentService.recordLumpSumPayment({
    supplierId:    req.body.supplierId,
    amountCents:   Number(req.body.amountCents),
    paymentMethod: req.body.paymentMethod as PaymentMethod,
    referenceNo:   req.body.referenceNo,
    bankName:      req.body.bankName,
    paymentDate:   req.body.paymentDate,
    notes:         req.body.notes,
    recordedById:  userId,
  });
  res.status(201).json(result);
};

export const applyCredit: RequestHandler = async (req, res) => {
  const userId = req.auth!.userId;
  const result = await supplierPaymentService.applyCreditToPurchases({
    supplierId:   req.body.supplierId,
    amountCents:  Number(req.body.amountCents),
    paymentDate:  req.body.paymentDate,
    notes:        req.body.notes,
    recordedById: userId,
  });
  res.status(201).json(result);
};

export const listCreditLedger: RequestHandler = async (req, res) => {
  const items = await supplierPaymentService.listCreditLedger(req.params.supplierId);
  res.json(items);
};

export const receiveCredit: RequestHandler = async (req, res) => {
  const userId = req.auth!.userId;
  const body = receiveCreditSchema.parse(req.body);
  const payment = await supplierPaymentService.receiveCreditFromSupplier({
    purchaseId:   body.purchaseId,
    supplierId:   body.supplierId,
    amountCents:  body.amountCents,
    method:       body.method as PaymentMethod,
    reference:    body.reference,
    date:         body.date,
    notes:        body.notes,
    recordedById: userId,
  });
  res.status(201).json(payment);
};

export const listByPurchase: RequestHandler = async (req, res) => {
  const payments = await supplierPaymentService.listByPurchase(req.params.purchaseId);
  res.json(payments);
};

export const listBySupplier: RequestHandler = async (req, res) => {
  const payments = await supplierPaymentService.listBySupplier(req.params.supplierId);
  res.json(payments);
};

export const getVoucherData: RequestHandler = async (req, res) => {
  const data = await supplierPaymentService.getVoucherData(req.params.id);
  res.json(data);
};

export const voidPayment: RequestHandler = async (req, res) => {
  const result = await supplierPaymentService.voidPayment(
    req.params.id,
    req.auth!.userId,
  );
  res.json(result);
};
