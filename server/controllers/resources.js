function respondWithDatabaseError(res, error) {
  if (error?.code === 'PGRST116') {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested record was not found.' } });
  }
  if (error?.code === '23505') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'A record with these details already exists.' } });
  }
  if (['23503', '23514', '22P02'].includes(error?.code)) {
    return res.status(400).json({ error: { code: 'INVALID_DATA', message: 'The submitted data is not valid.' } });
  }
  return res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'The request could not be completed.' } });
}

export function createOwnedController(table) {
  return {
    list: async (req, res) => {
      const filters = req.validatedQuery;
      const { page = 1, limit = 25, sort = 'created_at', direction = 'desc' } = filters;
      const sortableFields = {
        transactions: ['created_at', 'transaction_date', 'amount'],
        budgets: ['created_at', 'budget_month', 'amount_limit'],
        savings_goals: ['created_at', 'target_amount', 'target_date'],
        support_requests: ['created_at'],
      }[table];
      if (filters.sort && !sortableFields.includes(filters.sort)) {
        return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: `Sort field is not supported for ${table}.` } });
      }
      const start = (page - 1) * limit;
      let query = req.db.from(table).select('*', { count: 'exact' })
        .eq('user_id', req.user.id)
        .order(sort, { ascending: direction === 'asc' })
        .range(start, start + limit - 1);

      if (table === 'transactions') {
        if (filters.from) query = query.gte('transaction_date', filters.from);
        if (filters.to) query = query.lte('transaction_date', filters.to);
        if (filters.category_id) query = query.eq('category_id', filters.category_id);
        if (filters.transaction_type) query = query.eq('transaction_type', filters.transaction_type);
        if (filters.search) query = query.ilike('description', `%${filters.search}%`);
      }
      if (table === 'budgets' && filters.month) query = query.eq('budget_month', filters.month);

      const { data, count, error } = await query;
      if (error) return respondWithDatabaseError(res, error);
      return res.json({ data, pagination: { page, limit, total: count ?? 0 } });
    },

    create: async (req, res) => {
      const { data, error } = await req.db.from(table)
        .insert({ ...req.body, user_id: req.user.id }).select('*').single();
      if (error) return respondWithDatabaseError(res, error);
      return res.status(201).json({ data });
    },

    get: async (req, res) => {
      const { data, error } = await req.db.from(table).select('*')
        .eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
      if (error) return respondWithDatabaseError(res, error);
      if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested record was not found.' } });
      return res.json({ data });
    },

    update: async (req, res) => {
      const { data, error } = await req.db.from(table).update(req.body)
        .eq('id', req.params.id).eq('user_id', req.user.id).select('*').maybeSingle();
      if (error) return respondWithDatabaseError(res, error);
      if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested record was not found.' } });
      return res.json({ data });
    },

    remove: async (req, res) => {
      const { data, error } = await req.db.from(table).delete()
        .eq('id', req.params.id).eq('user_id', req.user.id).select('id').maybeSingle();
      if (error) return respondWithDatabaseError(res, error);
      if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested record was not found.' } });
      return res.status(204).end();
    },
  };
}

export function createCategoryController() {
  return {
    list: async (_req, res) => {
      const { data, error } = await _req.db.from('categories').select('*').order('transaction_type').order('name');
      if (error) return respondWithDatabaseError(res, error);
      return res.json({ data });
    },
    create: async (req, res) => {
      const { data, error } = await req.db.from('categories').insert(req.body).select('*').single();
      if (error) return respondWithDatabaseError(res, error);
      return res.status(201).json({ data });
    },
    update: async (req, res) => {
      const { data, error } = await req.db.from('categories').update(req.body)
        .eq('id', req.params.id).select('*').maybeSingle();
      if (error) return respondWithDatabaseError(res, error);
      if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested record was not found.' } });
      return res.json({ data });
    },
    remove: async (req, res) => {
      const { data, error } = await req.db.from('categories').delete()
        .eq('id', req.params.id).select('id').maybeSingle();
      if (error) return respondWithDatabaseError(res, error);
      if (!data) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'The requested record was not found.' } });
      return res.status(204).end();
    },
  };
}