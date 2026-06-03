import { z } from 'zod';

export const createDeliverySchema = z.object({
  saleId: z.string().min(1).optional().nullable(),
  quotationId: z.string().min(1).optional().nullable(),
  customerId: z.string().min(1).optional().nullable(),
  scheduledAt: z.string().datetime().optional().nullable(),
  address: z.string().min(1, 'Address is required'),
  contactName: z.string().max(200).optional().nullable(),
  contactPhone: z.string().max(40).optional().nullable(),
  driverName: z.string().max(200).optional().nullable(),
  driverPhone: z.string().max(40).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

export const updateDeliverySchema = z.object({
  scheduledAt: z.string().datetime().optional().nullable(),
  address: z.string().min(1).optional(),
  contactName: z.string().max(200).optional().nullable(),
  contactPhone: z.string().max(40).optional().nullable(),
  driverName: z.string().max(200).optional().nullable(),
  driverPhone: z.string().max(40).optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
});

export const deliveryStatusSchema = z.object({
  status: z.enum(['PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED']),
});

export type CreateDeliveryBody = z.infer<typeof createDeliverySchema>;
export type UpdateDeliveryBody = z.infer<typeof updateDeliverySchema>;
