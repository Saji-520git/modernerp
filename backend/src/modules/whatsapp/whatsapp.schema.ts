import { z } from 'zod';

// All WhatsApp API input validation lives here (Zod on every POST/PUT body).

export const updateConfigSchema = z.object({
  isEnabled:     z.boolean().optional(),
  mode:          z.enum(['WEB', 'API']).optional(),
  provider:      z.enum(['NONE', 'META', 'TWILIO']).optional(),
  apiKey:        z.string().nullable().optional(),
  apiSecret:     z.string().nullable().optional(),
  phoneNumberId: z.string().nullable().optional(),
  businessId:    z.string().nullable().optional(),
  twilioSid:     z.string().nullable().optional(),
  twilioToken:   z.string().nullable().optional(),
  twilioFrom:    z.string().nullable().optional(),
  ownerPhone:    z.string().nullable().optional(),
});

export const updateTemplateSchema = z.object({
  bodyEn:   z.string().min(1).optional(),
  bodySi:   z.string().nullable().optional(),
  subject:  z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const sendReceiptSchema = z.object({
  saleId:   z.string().min(1),
  language: z.enum(['en', 'si']).optional(),
});

export const sendReminderSchema = z.object({
  customerId: z.string().min(1),
});

export const sendDailySummarySchema = z.object({
  date: z.string().datetime().optional(),
});

export const sendOfferSchema = z.object({
  customerIds: z.array(z.string().min(1)).min(1),
  offerText:   z.string().min(1),
  validUntil:  z.string().optional(),
});

export type UpdateConfigInput = z.infer<typeof updateConfigSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
