import type { RequestHandler } from 'express';
import { supplierPaymentService } from './supplier-payment.service.js';
import type { PaymentMethod } from '@prisma/client';

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

export const listByPurchase: RequestHandler = async (req, res) => {
  const payments = await supplierPaymentService.listByPurchase(req.params.purchaseId);
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
