import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../app.js';
import { sumAmounts } from '../services/money.js';
import { budgetSchema, goalSchema, transactionSchema } from '../validators/schemas.js';

const userA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const recordA = { id: '11111111-1111-4111-8111-111111111111', user_id: userA, amount: '10.00', transaction_type: 'expense' };
const recordB = { id: '22222222-2222-4222-8222-222222222222', user_id: userB, amount: '20.00', transaction_type: 'expense' };

class MockQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.filters = [];
    this.operation = 'select';
    this.payload = null;
    this.countRequested = false;
  }

  select(_columns, options = {}) { this.countRequested = options.count === 'exact'; return this; }
  insert(payload) { this.operation = 'insert'; this.payload = payload; return this; }
  update(payload) { this.operation = 'update'; this.payload = payload; return this; }
  delete() { this.operation = 'delete'; return this; }
  eq(column, value) { this.filters.push((row) => String(row[column]) === String(value)); return this; }
  gte(column, value) { this.filters.push((row) => row[column] >= value); return this; }
  lte(column, value) { this.filters.push((row) => row[column] <= value); return this; }
  ilike(column, value) { this.filters.push((row) => String(row[column]).toLowerCase().includes(value.replaceAll('%', '').toLowerCase())); return this; }
  order() { return this; }
  range() { return this; }
  single() { return this.execute(true); }
  maybeSingle() { return this.execute(true, true); }
  then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }

  execute(single = false, allowMissing = false) {
    if (this.operation === 'insert') {
      const row = { id: '33333333-3333-4333-8333-333333333333', ...this.payload };
      this.db.rows[this.table].push(row);
      return { data: row, error: null };
    }

    const rows = (this.db.rows[this.table] ?? []).filter((row) => this.filters.every((filter) => filter(row)));
    if (this.operation === 'delete') return { data: rows[0] ?? null, error: null };
    if (this.operation === 'update') return { data: rows[0] ? { ...rows[0], ...this.payload } : null, error: null };
    if (single) {
      if (!rows.length && !allowMissing) return { data: null, error: { code: 'PGRST116' } };
      return { data: rows[0] ?? null, error: null };
    }
    return { data: rows, error: null, count: this.countRequested ? rows.length : null };
  }
}

function makeDatabase(userId) {
  return {
    userId,
    rows: {
      profiles: [
        { id: userA, role: 'user', full_name: 'Account A', budget_warning_threshold: 80 },
        { id: userB, role: 'user', full_name: 'Account B', budget_warning_threshold: 80 },
      ],
      categories: [],
      transactions: [recordA, recordB],
      budgets: [],
      savings_goals: [],
      support_requests: [],
    },
    from(table) {
      if (table === 'profiles' && userId === userA) this.rows.profiles[0].role = 'user';
      return new MockQuery(this, table);
    },
    async rpc(name, { p_from: from, p_to: to }) {
      assert.equal(name, 'get_financial_report');
      assert.match(from, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(to, /^\d{4}-\d{2}-\d{2}$/);
      const ownRows = this.rows.transactions.filter((row) => row.user_id === userId);
      return {
        data: {
          from,
          to,
          balance: userId === userA ? '-10.00' : '-20.00',
          income: '0.00',
          expenses: userId === userA ? '10.00' : '20.00',
          spending_by_category: [],
          monthly_totals: [],
          row_count: ownRows.length,
        },
        error: null,
      };
    },
  };
}

const seenDatabases = [];
let server;
let baseUrl;

before(async () => {
  const authClient = {
    auth: {
      signUp: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async ({ email }) => email === 'a@example.test'
        ? { data: { session: { access_token: 'user-a-token', refresh_token: 'refresh' } }, error: null }
        : email === 'unconfirmed@example.test'
          ? { data: { session: null }, error: Object.assign(new Error('Email not confirmed'), { code: 'email_not_confirmed' }) }
        : { data: { session: null }, error: new Error('invalid credentials') },
      getUser: async (token) => {
        if (!['user-a-token', 'admin-token'].includes(token)) return { data: { user: null }, error: new Error('invalid') };
        const id = token === 'admin-token' ? userB : userA;
        return { data: { user: { id, email: `${id === userA ? 'a' : 'admin'}@example.test` } }, error: null };
      },
    },
  };
  const app = createApp({
    env: { FRONTEND_ORIGIN: 'http://localhost:3000', NODE_ENV: 'development' },
    authClient,
    userClientFactory: (token) => {
      const id = token === 'admin-token' ? userB : userA;
      const db = makeDatabase(id);
      if (token === 'admin-token') db.rows.profiles[1].role = 'admin';
      seenDatabases.push({ id, db });
      return db;
    },
  });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(path, { token = 'user-a-token', ...options } = {}) {
  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

test('health check is public and returns a consistent response', async () => {
  const response = await request('/api/health', { token: null });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { data: { status: 'ok' } });
});

test('protected routes reject missing and invalid bearer tokens', async () => {
  assert.equal((await request('/api/profile', { token: null })).status, 401);
  assert.equal((await request('/api/profile', { token: 'not-a-valid-token' })).status, 401);
});

test('standard users cannot access administrator endpoints', async () => {
  const response = await request('/api/admin/stats');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'FORBIDDEN');
});

test('a database-promoted administrator can access non-sensitive statistics', async () => {
  const response = await request('/api/admin/stats', { token: 'admin-token' });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, { category_count: 0, support_requests_by_status: {} });
});

test('a user cannot read another account transaction', async () => {
  const response = await request(`/api/transactions/${recordB.id}`);
  assert.equal(response.status, 404);
  const lastDb = seenDatabases.at(-1).db;
  assert.equal(lastDb.rows.transactions.some((row) => row.id === recordB.id && row.user_id === userB), true);
});

test('transaction ownership is taken from the verified token, never the request body', async () => {
  const response = await request('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ transaction_type: 'income', amount: '125.00', description: 'Pay', transaction_date: '2026-10-01', user_id: userB }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});

test('malformed requests and non-positive transaction amounts are rejected', async () => {
  const invalidAmount = transactionSchema.safeParse({ transaction_type: 'expense', amount: '0.00', description: 'Zero', transaction_date: '2026-10-01' });
  assert.equal(invalidAmount.success, false);
  const malformed = await request('/api/transactions', { method: 'POST', body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, 'INVALID_JSON');
});

test('invalid budget and savings goal amounts fail validation', () => {
  assert.equal(budgetSchema.safeParse({ category_id: userA, amount_limit: '0.00', budget_month: '2026-10-01' }).success, false);
  assert.equal(goalSchema.safeParse({ name: 'Holiday', target_amount: '0.00', current_amount: '-1.00' }).success, false);
});

test('missing records return 404 instead of exposing database details', async () => {
  const response = await request('/api/transactions/99999999-9999-4999-8999-999999999999');
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, 'NOT_FOUND');
});

test('money totals remain exact for large and negative fractional balances', () => {
  assert.equal(sumAmounts(['100000000000.01', '0.09', '-100000000000.10']), '0.00');
  assert.equal(sumAmounts(['0.10', '-0.25']), '-0.15');
});

test('valid transaction creation assigns ownership from the verified user', async () => {
  const response = await request('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({ transaction_type: 'income', amount: '125.50', description: 'Pay', transaction_date: '2026-10-01' }),
  });
  assert.equal(response.status, 201);
  const { data } = await response.json();
  assert.equal(data.user_id, userA);
});

test('budget creation persists the period, category, amount, and verified owner', async () => {
  const budget = {
    category_id: '33333333-3333-4333-8333-333333333333',
    amount_limit: '950.00',
    budget_month: '2026-10-01',
  };
  const response = await request('/api/budgets', { method: 'POST', body: JSON.stringify(budget) });
  assert.equal(response.status, 201);
  const { data } = await response.json();
  assert.equal(data.user_id, userA);
  assert.equal(data.category_id, budget.category_id);
  assert.equal(data.amount_limit, budget.amount_limit);
  assert.equal(data.budget_month, budget.budget_month);
  assert.ok(seenDatabases.at(-1).db.rows.budgets.some((row) => row.id === data.id));
});

test('savings goal creation persists all fields and the verified owner', async () => {
  const goal = {
    name: 'Emergency reserve',
    target_amount: '12000.00',
    current_amount: '750.50',
    target_date: '2027-06-30',
  };
  const response = await request('/api/goals', { method: 'POST', body: JSON.stringify(goal) });
  assert.equal(response.status, 201);
  const { data } = await response.json();
  assert.equal(data.user_id, userA);
  for (const field of Object.keys(goal)) assert.equal(data[field], goal[field]);
  assert.ok(seenDatabases.at(-1).db.rows.savings_goals.some((row) => row.id === data.id));
});

test('financial summaries run through the caller-scoped database client', async () => {
  const response = await request('/api/reports/summary?from=2026-10-01&to=2026-10-31');
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.balance, '-10.00');
  assert.equal(data.expenses, '10.00');
  assert.equal(data.row_count, 1);
  assert.equal(seenDatabases.at(-1).id, userA);
});

test('registration validates credentials and lets Supabase handle password storage', async () => {
  const invalid = await request('/api/auth/register', {
    method: 'POST', token: null,
    body: JSON.stringify({ email: 'not-an-email', password: 'weak', full_name: 'A User' }),
  });
  assert.equal(invalid.status, 400);

  const response = await request('/api/auth/register', {
    method: 'POST', token: null,
    body: JSON.stringify({ email: 'new@example.test', password: 'StrongPass123', full_name: 'New User' }),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { data: { session: null, needs_email_confirmation: true } });
});

test('login returns a Supabase session and hides credential-specific errors', async () => {
  const valid = await request('/api/auth/login', {
    method: 'POST', token: null,
    body: JSON.stringify({ email: 'a@example.test', password: 'StrongPass123' }),
  });
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).data.session.access_token, 'user-a-token');

  const invalid = await request('/api/auth/login', {
    method: 'POST', token: null,
    body: JSON.stringify({ email: 'unknown@example.test', password: 'wrong' }),
  });
  assert.equal(invalid.status, 401);
  assert.equal((await invalid.json()).error.message, 'Email or password is incorrect.');
});

test('login explains when Supabase requires email confirmation', async () => {
  const response = await request('/api/auth/login', {
    method: 'POST', token: null,
    body: JSON.stringify({ email: 'unconfirmed@example.test', password: 'StrongPass123' }),
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, 'EMAIL_NOT_CONFIRMED');
});

test('a user cannot update or delete another account transaction', async () => {
  const update = await request(`/api/transactions/${recordB.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ amount: '0.01' }),
  });
  assert.equal(update.status, 404);

  const remove = await request(`/api/transactions/${recordB.id}`, { method: 'DELETE' });
  assert.equal(remove.status, 404);
  assert.equal(seenDatabases.at(-1).db.rows.transactions.find((row) => row.id === recordB.id).amount, '20.00');
});

test('profile writes reject browser-supplied role changes', async () => {
  const response = await request('/api/profile', {
    method: 'PATCH',
    body: JSON.stringify({ full_name: 'Account A', role: 'admin' }),
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
});

test('development CORS allows both standard Live Server loopback origins', async () => {
  for (const origin of ['http://localhost:5500', 'http://127.0.0.1:5500']) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  }
});

test('auth rate limiting returns an actionable retry response', async () => {
  const limitedApp = createApp({
    env: {
      FRONTEND_ORIGIN: 'http://localhost:3000',
      NODE_ENV: 'development',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_ANON_KEY: 'publishable-test-key',
    },
  });
  const limitedServer = limitedApp.listen(0);
  await new Promise((resolve) => limitedServer.once('listening', resolve));
  const limitedBaseUrl = `http://127.0.0.1:${limitedServer.address().port}`;

  try {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await fetch(`${limitedBaseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'invalid', password: '' }),
    });
    assert.equal(response.status, 400);
  }

  const limited = await fetch(`${limitedBaseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'invalid', password: '' }),
  });
  const body = await limited.json();
  assert.equal(limited.status, 429);
  assert.equal(body.error.code, 'RATE_LIMITED');
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.ok(body.error.message.includes('Try again in about'));
  } finally {
    await new Promise((resolve, reject) => limitedServer.close((error) => error ? reject(error) : resolve()));
  }
});