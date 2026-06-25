import { z } from 'zod';

// ─── Checkout ─────────────────────────────────────────────────────────────────

export const checkoutLineSchema = z.object({
  productId:      z.string().cuid(),
  qty:            z.number().min(0.0001, 'Quantity must be greater than 0'),
  unitPriceCents: z.number().int().min(0).optional(), // price override (requires adjust_sale_price perm)
  unitId:         z.string().optional(),              // unit used for this line (if omitted, uses base unit)
  discountCents:  z.number().int().min(0).default(0), // per-line discount in cents
});

export const checkoutSchema = z.object({
  warehouseId:         z.string().cuid(),
  customerId:          z.string().cuid().optional(),
  paymentMethod:       z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'QR_PAY', 'CREDIT']).default('CASH'),
  cartDiscountCents:   z.number().int().min(0).default(0),    // cart-level discount in cents
  cartDiscountPercent: z.number().min(0).max(100).default(0), // cart-level discount percent
  cashAmountCents:     z.number().int().min(0).optional(),    // split payment: cash paid now (remainder = credit/outstanding)
  note:                z.string().max(500).optional(),
  items:               z.array(checkoutLineSchema).min(1, 'Cart must have at least one item'),
  draftId:             z.string().cuid().optional(), // delete this draft after successful checkout
  isStaffSale:         z.boolean().optional().default(false), // tag this sale as a staff purchase
});

// ─── Product search ───────────────────────────────────────────────────────────

export const productSearchSchema = z.object({
  search:      z.string().optional(),
  warehouseId: z.string().cuid().optional(),
  categoryId:  z.string().cuid().optional(),
  page:        z.coerce.number().int().min(1).default(1),
  pageSize:    z.coerce.number().int().min(1).max(200).default(24),
});

// ─── Sales list ───────────────────────────────────────────────────────────────

export const listSalesSchema = z.object({
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search:   z.string().optional(),
  from:     z.coerce.date().optional(),
  to:       z.coerce.date().optional(),
});

// ─── Draft ────────────────────────────────────────────────────────────────────

export const saveDraftSchema = z.object({
  id:            z.string().cuid().optional(), // if present → update existing draft
  label:         z.string().max(100).optional().nullable(),
  warehouseId:   z.string().cuid(),
  customerId:    z.string().cuid().optional().nullable(),
  paymentMethod: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'QR_PAY', 'CREDIT']).default('CASH'),
  discountCents: z.number().int().min(0).default(0),
  note:          z.string().max(500).optional().nullable(),
  items:         z.array(z.object({
    productId:      z.string().cuid(),
    qty:            z.number().int().min(1, 'Quantity must be at least 1'),
    unitPriceCents: z.number().int().min(0),
  })).min(0),
});

// ─── Shifts ───────────────────────────────────────────────────────────────────

export const openShiftSchema = z.object({
  warehouseId: z.string().min(1),
  openingCash: z.number().min(0).default(0),
});

export const closeShiftSchema = z.object({
  shiftId:     z.string().min(1),
  closingCash: z.number().min(0).default(0),
  note:        z.string().max(500).optional(),
});

export const forceCloseShiftSchema = z.object({
  note: z.string().max(500).optional(),
});

export const listShiftsSchema = z.object({
  page:        z.coerce.number().int().min(1).default(1),
  pageSize:    z.coerce.number().int().min(1).max(100).default(20),
  warehouseId: z.string().optional(),
  userId:      z.string().optional(),
  status:      z.enum(['OPEN', 'CLOSED']).optional(),
  from:        z.coerce.date().optional(),
  to:          z.coerce.date().optional(),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type CheckoutInput        = z.infer<typeof checkoutSchema>;
export type ProductSearchInput   = z.infer<typeof productSearchSchema>;
export type ListSalesInput       = z.infer<typeof listSalesSchema>;
export type SaveDraftInput       = z.infer<typeof saveDraftSchema>;
export type OpenShiftInput       = z.infer<typeof openShiftSchema>;
export type CloseShiftInput      = z.infer<typeof closeShiftSchema>;
export type ForceCloseShiftInput = z.infer<typeof forceCloseShiftSchema>;
export type ListShiftsInput      = z.infer<typeof listShiftsSchema>;
