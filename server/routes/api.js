import { Router } from 'express';
import { z } from 'zod';
import { createOwnedController, createCategoryController } from '../controllers/resources.js';
import { requireAdmin } from '../middleware/auth.js';
import {
  budgetSchema, categorySchema, goalSchema, idParamsSchema, profileSchema,
  supportSchema, transactionSchema, validate,
} from '../validators/schemas.js';

const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['created_at', 'transaction_date', 'amount', 'budget_month']).optional(),
  direction: z.enum(['asc', 'desc']).default('desc'),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  month: z.iso.date().optional(),
  category_id: z.string().uuid().optional(),
  transaction_type: z.enum(['income', 'expense']).optional(),
  search: z.string().trim().max(100).optional(),
}).strict().refine((query) => !query.from || !query.to || query.from <= query.to, {
  path: ['to'], message: 'End date must be on or after start date.',
});

const transactionController = createOwnedController('transactions');
const budgetController = createOwnedController('budgets');
const goalController = createOwnedController('savings_goals');
const supportController = createOwnedController('support_requests');
const categoryController = createCategoryController();

function resourceRoutes(router, path, controller, schema, updateSchema = schema) {
  router.get(path, validate(pagination, 'query'), controller.list);
  router.post(path, validate(schema), controller.create);
  router.get(`${path}/:id`, validate(idParamsSchema, 'params'), controller.get);
  router.patch(`${path}/:id`, validate(idParamsSchema, 'params'), validate(updateSchema), controller.update);
  router.delete(`${path}/:id`, validate(idParamsSchema, 'params'), controller.remove);
}

function partialUpdateSchema(schema) {
  return schema.partial().strict().refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });
}

export function createApiRouter() {
  const router = Router();

  router.get('/profile', async (req, res) => {
    const { data, error } = await req.db.from('profiles').select('id, full_name, role, budget_warning_threshold, created_at').eq('id', req.user.id).single();
    if (error) return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Profile could not be loaded.' } });
    return res.json({ data });
  });
  router.patch('/profile', validate(profileSchema), async (req, res) => {
    const { data, error } = await req.db.from('profiles').update(req.body).eq('id', req.user.id)
      .select('id, full_name, role, budget_warning_threshold, created_at').single();
    if (error) return res.status(400).json({ error: { code: 'PROFILE_UPDATE_FAILED', message: 'Profile could not be updated.' } });
    return res.json({ data });
  });

  router.get('/categories', categoryController.list);
  router.post('/categories', requireAdmin, validate(categorySchema), categoryController.create);
  router.patch('/categories/:id', requireAdmin, validate(idParamsSchema, 'params'), validate(partialUpdateSchema(categorySchema)), categoryController.update);
  router.delete('/categories/:id', requireAdmin, validate(idParamsSchema, 'params'), categoryController.remove);

  resourceRoutes(router, '/transactions', transactionController, transactionSchema, partialUpdateSchema(transactionSchema));
  resourceRoutes(router, '/budgets', budgetController, budgetSchema, partialUpdateSchema(budgetSchema));
  resourceRoutes(router, '/goals', goalController, goalSchema, partialUpdateSchema(goalSchema));
  resourceRoutes(router, '/support-requests', supportController, supportSchema, partialUpdateSchema(supportSchema));

  router.patch('/admin/support-requests/:id', requireAdmin, validate(idParamsSchema, 'params'),
    validate(z.object({ status: z.enum(['open', 'in_progress', 'resolved', 'closed']) }).strict()),
    async (req, res) => {
      const { data, error } = await req.db.from('support_requests').update({ status: req.body.status })
        .eq('id', req.params.id).select('id, status, updated_at').maybeSingle();
      if (error) return res.status(400).json({ error: { code: 'UPDATE_FAILED', message: 'Request status could not be updated.' } });
      if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The support request was not found.' } });
      return res.json({ data });
    });

  router.get('/admin/support-requests', requireAdmin, validate(pagination, 'query'), async (req, res) => {
    const { page = 1, limit = 25 } = req.validatedQuery;
    const start = (page - 1) * limit;
    const { data, count, error } = await req.db.from('support_requests')
      .select('id, user_id, subject, message, status, created_at, updated_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(start, start + limit - 1);
    if (error) return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Support requests could not be loaded.' } });
    return res.json({ data, pagination: { page, limit, total: count ?? 0 } });
  });

  router.get('/reports/summary', validate(z.object({ from: z.iso.date(), to: z.iso.date() }).strict(), 'query'), async (req, res) => {
    const { from, to } = req.validatedQuery;
    if (from > to) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'End date must be on or after start date.' } });
    const { data, error } = await req.db.rpc('get_financial_report', { p_from: from, p_to: to });
    if (error) {
      return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Report data could not be loaded.' } });
    }
    return res.json({ data });
  });

  router.get('/admin/stats', requireAdmin, async (req, res) => {
    const [categories, requests] = await Promise.all([
      req.db.from('categories').select('id', { count: 'exact', head: true }),
      req.db.from('support_requests').select('status'),
    ]);
    if (categories.error || requests.error) {
      return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'System statistics could not be loaded.' } });
    }
    const supportByStatus = (requests.data ?? []).reduce((counts, request) => {
      counts[request.status] = (counts[request.status] ?? 0) + 1;
      return counts;
    }, {});
    return res.json({ data: {
      category_count: categories.count ?? 0,
      support_requests_by_status: supportByStatus,
    } });
  });

  return router;
}