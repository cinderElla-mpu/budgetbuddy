import { z } from 'zod';

const uuid = z.string().uuid();
const date = z.iso.date();
const amount = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter an amount with up to two decimal places.');
const password = z.string().min(10).max(128)
  .regex(/[a-z]/, 'Password must include a lowercase letter.')
  .regex(/[A-Z]/, 'Password must include an uppercase letter.')
  .regex(/[0-9]/, 'Password must include a number.');

export const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(128),
}).strict();

export const registerSchema = loginSchema.extend({
  password,
  full_name: z.string().trim().min(1).max(100),
}).strict();

export const transactionSchema = z.object({
  category_id: uuid.nullable().optional(),
  transaction_type: z.enum(['income', 'expense']),
  amount: amount.refine((value) => Number(value) > 0, 'Amount must be greater than zero.'),
  description: z.string().trim().min(1).max(240),
  transaction_date: date,
}).strict();

export const budgetSchema = z.object({
  category_id: uuid,
  amount_limit: amount.refine((value) => Number(value) > 0, 'Budget must be greater than zero.'),
  budget_month: date.refine((value) => value.endsWith('-01'), 'Use the first day of the budget month.'),
}).strict();

export const goalSchema = z.object({
  name: z.string().trim().min(1).max(100),
  target_amount: amount.refine((value) => Number(value) > 0, 'Target must be greater than zero.'),
  current_amount: amount.refine((value) => Number(value) >= 0, 'Saved amount cannot be negative.').default('0.00'),
  target_date: date.nullable().optional(),
}).strict();

export const supportSchema = z.object({
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(5000),
}).strict();

export const profileSchema = z.object({
  full_name: z.string().trim().min(1).max(100),
  budget_warning_threshold: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  transaction_type: z.enum(['income', 'expense']),
}).strict();

export const idParamsSchema = z.object({ id: uuid });

export function validate(schema, source = 'body') {
  return function validateRequest(req, res, next) {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const fields = result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      }));
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Check the submitted fields.', fields } });
    }
    if (source === 'query') req.validatedQuery = result.data;
    else if (source === 'params') req.validatedParams = result.data;
    else req.body = result.data;
    return next();
  };
}