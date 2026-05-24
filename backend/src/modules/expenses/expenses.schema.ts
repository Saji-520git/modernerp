import { z } from 'zod';

export const createExpenseSchema = z.object({
  categoryId:    z.string().min(1, 'Category required'),
  amount:        z.number().int().positive('Amount must be positive'),
  description:   z.string().min(1, 'Description required').max(500),
  date:          z.string().datetime(),
  paymentMethod: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'QR_PAY', 'CREDIT']).default('CASH'),
  reference:     z.string().max(200).optional().nullable(),
  isRecurring:   z.boolean().default(false),
  recurringDay:  z.number().int().min(1).max(31).optional().nullable(),
});

export const updateExpenseSchema = createExpenseSchema.partial();

export const listExpensesSchema = z.object({
  categoryId:   z.string().optional(),
  from:         z.string().optional(),
  to:           z.string().optional(),
  search:       z.string().optional(),
  isRecurring:  z.coerce.boolean().optional(),
  page:         z.coerce.number().int().positive().default(1),
  pageSize:     z.coerce.number().int().positive().max(100).default(25),
});

export const createCategorySchema = z.object({
  name:          z.string().min(1).max(100),
  color:         z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be hex color').default('#6366f1'),
  monthlyBudget: z.number().int().min(0).optional().nullable(),
});

export const updateCategorySchema = z.object({
  name:          z.string().min(1).max(100).optional(),
  color:         z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  monthlyBudget: z.number().int().min(0).optional().nullable(),
});

export type CreateExpenseInput   = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput   = z.infer<typeof updateExpenseSchema>;
export type ListExpensesInput    = z.infer<typeof listExpensesSchema>;
export type CreateCategoryInput  = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput  = z.infer<typeof updateCategorySchema>;
