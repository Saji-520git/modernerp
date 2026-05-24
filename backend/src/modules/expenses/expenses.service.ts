import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import type {
  CreateExpenseInput, UpdateExpenseInput, ListExpensesInput,
  CreateCategoryInput, UpdateCategoryInput,
} from './expenses.schema.js';

export const expensesService = {

  // ── Categories ────────────────────────────────────────────────────────────

  listCategories: async () => {
    return (prisma as any).expenseCategory.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: 'asc' },
      include: { _count: { select: { expenses: { where: { deletedAt: null, isRecurring: false } } } } },
    });
  },

  createCategory: async (input: CreateCategoryInput) => {
    const existing = await (prisma as any).expenseCategory.findFirst({
      where: { name: { equals: input.name, mode: 'insensitive' }, isActive: true, deletedAt: null },
    });
    if (existing) throw new HttpError(400, `Category "${existing.name}" already exists`);
    return (prisma as any).expenseCategory.create({ data: input });
  },

  updateCategory: async (id: string, input: UpdateCategoryInput) => {
    const cat = await (prisma as any).expenseCategory.findFirst({ where: { id, deletedAt: null } });
    if (!cat) throw new HttpError(404, 'Category not found');
    return (prisma as any).expenseCategory.update({
      where: { id },
      data: {
        ...(input.name          !== undefined ? { name:          input.name }          : {}),
        ...(input.color         !== undefined ? { color:         input.color }         : {}),
        ...(input.monthlyBudget !== undefined ? { monthlyBudget: input.monthlyBudget } : {}),
      },
    });
  },

  deleteCategory: async (id: string, userId: string) => {
    const cat = await (prisma as any).expenseCategory.findFirst({ where: { id, deletedAt: null } });
    if (!cat) throw new HttpError(404, 'Category not found');
    // Count only non-deleted expenses so soft-deleted expenses don't block category removal
    const activeExpenses = await (prisma as any).expense.count({
      where: { categoryId: id, deletedAt: null },
    });
    if (activeExpenses > 0) {
      throw new HttpError(400, 'Cannot delete category with existing expenses. Reassign expenses first.');
    }
    await (prisma as any).expenseCategory.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId },
    });
    return { success: true };
  },

  // ── Expenses ─────────────────────────────────────────────────────────────

  listExpenses: async (input: ListExpensesInput) => {
    const { categoryId, from, to, search, page, pageSize } = input;
    const skip = (page - 1) * pageSize;

    // isRecurring: true rows are templates; deletedAt != null rows are soft-deleted.
    // Both are excluded from the ledger view.
    const where = {
      isRecurring: false,
      deletedAt:   null,
      ...(categoryId ? { categoryId } : {}),
      ...(from || to ? {
        date: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to   ? { lte: new Date(to + 'T23:59:59Z') } : {}),
        },
      } : {}),
      ...(search ? {
        OR: [
          { description: { contains: search, mode: 'insensitive' as const } },
          { reference:   { contains: search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };

    const [total, data] = await prisma.$transaction([
      (prisma as any).expense.count({ where }),
      (prisma as any).expense.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { date: 'desc' },
        include: {
          category:  { select: { id: true, name: true, color: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
      }),
    ]);

    return { total, page, pageSize, data };
  },

  createExpense: async (input: CreateExpenseInput, userId: string) => {
    const cat = await (prisma as any).expenseCategory.findFirst({
      where: { id: input.categoryId, isActive: true, deletedAt: null },
    });
    if (!cat) {
      logger.warn({ categoryId: input.categoryId, userId }, 'createExpense: category not found or inactive');
      throw new HttpError(400, 'Category not found');
    }

    // When recording a one-off occurrence of a recurring template, resolve the
    // template row and derive monthYear so the DB unique constraint can enforce dedup.
    let recurringTemplateId: string | null = null;
    let monthYear: string | null = null;

    if (!input.isRecurring) {
      const template = await (prisma as any).expense.findFirst({
        where: { description: input.description, categoryId: input.categoryId, isRecurring: true, deletedAt: null },
      });
      if (template) {
        const d = new Date(input.date);
        monthYear           = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        recurringTemplateId = template.id as string;

        // Software-level check gives a friendlier error than a raw DB constraint violation
        const duplicate = await (prisma as any).expense.findFirst({
          where: { recurringTemplateId, monthYear, deletedAt: null },
        });
        if (duplicate) throw new HttpError(400, 'Already recorded this month');
      }
    }

    const include = {
      category:  { select: { id: true, name: true, color: true } },
      createdBy: { select: { id: true, fullName: true } },
    };

    if (input.isRecurring) {
      // Template row — recurringTemplateId and monthYear must be ABSENT
      // so the @@unique([recurringTemplateId, monthYear]) index never fires.
      return (prisma as any).expense.create({
        data: {
          categoryId:    input.categoryId,
          amount:        input.amount,
          description:   input.description,
          date:          new Date(input.date),
          paymentMethod: input.paymentMethod,
          reference:     input.reference ?? null,
          isRecurring:   true,
          recurringDay:  input.recurringDay ?? null,
          createdById:   userId,
        },
        include,
      });
    }

    // Occurrence or plain one-off expense — may carry recurringTemplateId + monthYear
    return (prisma as any).expense.create({
      data: {
        categoryId:          input.categoryId,
        amount:              input.amount,
        description:         input.description,
        date:                new Date(input.date),
        paymentMethod:       input.paymentMethod,
        reference:           input.reference ?? null,
        isRecurring:         false,
        recurringDay:        null,
        recurringTemplateId,
        monthYear,
        createdById:         userId,
      },
      include,
    });
  },

  updateExpense: async (id: string, input: UpdateExpenseInput) => {
    const existing = await (prisma as any).expense.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new HttpError(404, 'Expense not found');

    return (prisma as any).expense.update({
      where: { id },
      data: {
        ...(input.categoryId    !== undefined ? { categoryId:    input.categoryId }                : {}),
        ...(input.amount        !== undefined ? { amount:        input.amount }                    : {}),
        ...(input.description   !== undefined ? { description:   input.description }               : {}),
        ...(input.date          !== undefined ? { date:          new Date(input.date) }            : {}),
        ...(input.paymentMethod !== undefined ? { paymentMethod: input.paymentMethod }             : {}),
        ...(input.reference     !== undefined ? { reference:     input.reference ?? null }         : {}),
        ...(input.isRecurring   !== undefined ? { isRecurring:   input.isRecurring }               : {}),
        ...(input.recurringDay  !== undefined ? { recurringDay:  input.recurringDay ?? null }      : {}),
      },
      include: {
        category:  { select: { id: true, name: true, color: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });
  },

  deleteExpense: async (id: string, userId: string) => {
    const existing = await (prisma as any).expense.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new HttpError(404, 'Expense not found');
    await (prisma as any).expense.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId },
    });
    return { success: true };
  },

  deleteRecurringTemplate: async (id: string, userId: string) => {
    const template = await (prisma as any).expense.findFirst({
      where: { id, isRecurring: true, deletedAt: null },
    });
    if (!template) throw new HttpError(404, 'Recurring expense not found');

    const now = new Date();
    await (prisma as any).expense.update({
      where: { id },
      data: { deletedAt: now, deletedById: userId },
    });

    // Soft-delete all occurrence rows linked to this template so they
    // disappear from All Expenses as well.
    await (prisma as any).expense.updateMany({
      where: { recurringTemplateId: id, deletedAt: null },
      data:  { deletedAt: now, deletedById: userId },
    });

    return { success: true };
  },

  // ── Recurring expenses due ────────────────────────────────────────────────

  getRecurringDue: async () => {
    const today     = new Date().getDate(); // day of month (1-31)
    const now       = new Date();
    const monthYear = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    const recurring = await (prisma as any).expense.findMany({
      where: { isRecurring: true, deletedAt: null },
      include: {
        category:  { select: { id: true, name: true, color: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { recurringDay: 'asc' },
    });

    if (recurring.length === 0) return [];

    // Use the new recurringTemplateId+monthYear linkage for a precise recorded-this-month check.
    // (Old occurrences created before the migration have recurringTemplateId=NULL and will
    //  correctly appear as not-yet-recorded until re-recorded with the new fields.)
    const templateIds   = (recurring as any[]).map((e: any) => e.id);
    const recordings    = await (prisma as any).expense.findMany({
      where: { recurringTemplateId: { in: templateIds }, monthYear, deletedAt: null },
      select: { recurringTemplateId: true },
    });
    const recordedSet = new Set((recordings as any[]).map((r: any) => r.recurringTemplateId));

    return (recurring as any[]).map((e: any) => ({
      ...e,
      isDue:             e.recurringDay !== null && e.recurringDay <= today,
      recordedThisMonth: recordedSet.has(e.id),
    }));
  },

  // ── Monthly summary with budget ───────────────────────────────────────────

  getMonthlySummary: async (year?: number, month?: number) => {
    const now  = new Date();
    const y    = year  ?? now.getFullYear();
    const m    = month ?? now.getMonth() + 1;
    const from = new Date(y, m - 1, 1);
    const to   = new Date(y, m, 0, 23, 59, 59);

    const prevFrom = new Date(y, m - 2, 1);
    const prevTo   = new Date(y, m - 1, 0, 23, 59, 59);

    const [currentExpenses, prevTotal, categories] = await Promise.all([
      (prisma as any).expense.findMany({
        // isRecurring: false — exclude templates; deletedAt: null — exclude soft-deleted
        where: { isRecurring: false, deletedAt: null, date: { gte: from, lte: to } },
        include: { category: { select: { id: true, name: true, color: true, monthlyBudget: true } } },
      }),
      (prisma as any).expense.aggregate({
        where: { isRecurring: false, deletedAt: null, date: { gte: prevFrom, lte: prevTo } },
        _sum: { amount: true },
      }),
      (prisma as any).expenseCategory.findMany({ where: { isActive: true } }),
    ]);

    const totalCents = (currentExpenses as { amount: number }[]).reduce((s, e) => s + e.amount, 0);

    const byCat = new Map<string, {
      id: string; name: string; color: string;
      totalCents: number; budget: number | null; overBudget: boolean;
    }>();

    for (const e of currentExpenses as any[]) {
      const key = e.category.id;
      const existing = byCat.get(key) ?? {
        id: e.category.id, name: e.category.name, color: e.category.color,
        totalCents: 0, budget: e.category.monthlyBudget ?? null, overBudget: false,
      };
      const updated = { ...existing, totalCents: existing.totalCents + e.amount };
      updated.overBudget = updated.budget !== null && updated.totalCents > updated.budget;
      byCat.set(key, updated);
    }

    const prevTotalCents = (prevTotal._sum.amount ?? 0) as number;
    const changePct = prevTotalCents === 0 ? null
      : Math.round(((totalCents - prevTotalCents) / prevTotalCents) * 100);

    const overBudgetCount = [...byCat.values()].filter(c => c.overBudget).length;

    return {
      month: `${y}-${String(m).padStart(2, '0')}`,
      totalCents,
      prevTotalCents,
      changePct,
      count: (currentExpenses as any[]).length,
      overBudgetCount,
      byCategory: [...byCat.values()].sort((a, b) => b.totalCents - a.totalCents),
    };
  },
};
