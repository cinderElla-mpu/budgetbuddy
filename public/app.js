const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const config = window.budgetBuddyConfig ?? {};
const apiBase = config.apiBaseUrl ?? '';
const placeholderConfig = !config.supabaseUrl || config.supabaseUrl.includes('your-project')
  || !config.supabaseAnonKey || config.supabaseAnonKey.includes('your-supabase');
const state = {
  session: null,
  profile: null,
  categories: [],
  page: 'overview',
  authMode: 'login',
  month: new Date().toISOString().slice(0, 7),
  transactionPage: 1,
  transactionTotal: 0,
  busy: false,
  pageError: '',
};

const moneyFormat = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' });
const monthFormat = new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric' });
const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const amountText = (value) => moneyFormat.format(Number(value ?? 0));
const getMonthStart = (month) => `${month}-01`;
const getMonthEnd = (month) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
};
const addMonths = (month, amount) => {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + amount, 1)).toISOString().slice(0, 7);
};
const displayMonth = (month) => monthFormat.format(new Date(`${String(month).slice(0, 7)}-01T12:00:00`));
const toCents = (value) => {
  const text = String(value ?? '0');
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return negative ? -cents : cents;
};
const fromCents = (value) => {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
};
const sumMoney = (values) => fromCents(values.reduce((sum, value) => sum + toCents(value), 0n));
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;

let supabaseClient;
if (!placeholderConfig && window.supabase?.createClient) {
  supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

function drawIcons() {
  window.lucide?.createIcons?.();
}

function toast(message, kind = 'success') {
  let region = document.querySelector('.toast-region');
  if (!region) {
    region = document.createElement('div');
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }
  const item = document.createElement('div');
  item.className = `toast ${kind === 'error' ? 'error' : ''}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 4500);
}

async function api(path, options = {}) {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session?.access_token) throw new Error('Your session has expired. Please sign in again.');
  const response = await fetch(`${apiBase}/api${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const result = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) await supabaseClient.auth.signOut();
    const error = new Error(result?.error?.fields?.map((field) => `${field.field}: ${field.message}`).join(' ') || result?.error?.message || 'Request failed. Please try again.');
    error.status = response.status;
    throw error;
  }
  return result;
}

const apiJSON = (method, body) => ({ method, body: JSON.stringify(body) });

function renderAuth(message = '') {
  const register = state.authMode === 'register';
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-story" aria-label="About BudgetBuddy">
        <div class="auth-header"><a class="brand" href="#"><span class="brand-mark">${icon('orbit')}</span><span>budget<em>buddy</em></span></a><nav class="auth-nav" aria-label="Account"><button type="button" data-auth-mode="login">Sign in</button><button type="button" data-auth-mode="register">Create account</button></nav></div>
        <div class="story-content">
          <span class="eyebrow">A clearer view of your money</span>
          <h1>Your money,<br><span>in focus.</span></h1>
          <p>Know what comes in, where it goes, and what you are working towards. A personal finance space built around your real numbers.</p>
          <div class="story-lines">
            <div class="story-line">${icon('arrow-left-right')}One clear transaction history</div>
            <div class="story-line">${icon('chart-no-axes-combined')}Monthly spending, made visible</div>
            <div class="story-line">${icon('target')}Savings that have a direction</div>
          </div>
        </div>
        <div class="story-footer">BUDGETBUDDY · ZAR · YOUR OWN FINANCIAL RECORDS</div>
      </section>
      <section class="auth-side">
        <div class="auth-card">
          <h2>${register ? 'Start with a clear picture' : 'Good to see you again'}</h2>
          <p>${register ? 'Create your private BudgetBuddy account.' : 'Sign in to your personal finance workspace.'}</p>
          ${placeholderConfig ? '<div class="notice" role="status">Add your Supabase project URL and public key to <strong>public/config.js</strong> to enable real account access.</div>' : ''}
          <div class="auth-switch" role="group" aria-label="Account action">
            <button type="button" data-auth-mode="login" aria-pressed="${!register}">Sign in</button>
            <button type="button" data-auth-mode="register" aria-pressed="${register}">Create account</button>
          </div>
          <form id="auth-form" novalidate>
            ${register ? `<div class="field"><label for="full-name">Your name</label><input id="full-name" name="full_name" autocomplete="name" maxlength="100" required placeholder="First and last name"></div>` : ''}
            <div class="field"><label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@example.com"></div>
            <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" minlength="10" required placeholder="At least 10 characters">${register ? '<span class="field-hint">Use 10+ characters with uppercase, lowercase and a number.</span>' : ''}</div>
            <p class="form-message" role="alert">${escapeHTML(message)}</p>
            <button class="btn btn-primary btn-block" type="submit" ${placeholderConfig || state.busy ? 'disabled' : ''}>${icon(register ? 'user-round-plus' : 'log-in')}<span>${state.busy ? 'Please wait...' : register ? 'Create account' : 'Sign in'}</span></button>
          </form>
          <p class="field-hint" style="margin-top:16px">Your records are private to your account. BudgetBuddy does not connect to bank accounts.</p>
        </div>
      </section>
    </main>`;
  drawIcons();
}

const navItems = [
  { id: 'overview', label: 'Overview', icon: 'layout-dashboard' },
  { id: 'transactions', label: 'Transactions', icon: 'arrow-left-right' },
  { id: 'budgets', label: 'Budgets', icon: 'chart-pie' },
  { id: 'goals', label: 'Savings goals', icon: 'target' },
  { id: 'reports', label: 'Reports', icon: 'chart-no-axes-combined' },
  { id: 'support', label: 'Support', icon: 'messages-square' },
  { id: 'admin', label: 'Admin', icon: 'shield-check', admin: true },
  { id: 'settings', label: 'Settings', icon: 'settings-2' },
];

function renderFrame(content, options = {}) {
  const pageTitle = navItems.find((item) => item.id === state.page)?.label ?? 'Overview';
  const initial = state.profile?.full_name?.trim()?.[0]?.toUpperCase() ?? 'B';
  const name = state.profile?.full_name || 'BudgetBuddy member';
  const shownItems = navItems.filter((item) => !item.admin || state.profile?.role === 'admin');
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <a class="brand" href="#"><span class="brand-mark">${icon('orbit')}</span><span>budget<em>buddy</em></span></a>
        <div class="nav-label">Workspace</div>
        <nav aria-label="Main navigation"><div class="nav-list">${shownItems.map((item) => `
          <button class="nav-link" type="button" data-page="${item.id}" aria-current="${state.page === item.id ? 'page' : 'false'}">${icon(item.icon)}<span>${item.label}</span></button>`).join('')}
        </div></nav>
        <div class="sidebar-bottom">
          <div class="sidebar-note"><strong>A clearer monthly picture</strong><p>Track what you record here. This is not a bank balance.</p></div>
          <div class="user-chip"><span class="avatar">${escapeHTML(initial)}</span><div class="user-meta"><strong>${escapeHTML(name)}</strong><span>${state.profile?.role === 'admin' ? 'Administrator' : 'Personal account'}</span></div><button class="icon-button" type="button" data-action="signout" aria-label="Sign out" title="Sign out">${icon('log-out')}</button></div>
        </div>
      </aside>
      <section class="main-column">
        <header class="topbar">
          <div class="crumbs"><span>Workspace</span><span>/</span><strong>${escapeHTML(pageTitle)}</strong></div>
          <div class="top-actions">
            ${options.monthPicker ? `<label class="sr-only" for="active-month">Select reporting month</label><input class="month-pick" id="active-month" type="month" value="${escapeHTML(state.month)}">` : ''}
            <button class="icon-button" type="button" data-page="support" aria-label="Support" title="Support">${icon('messages-square')}</button>
            ${state.profile?.role === 'admin' ? `<button class="icon-button" type="button" data-page="admin" aria-label="Administration" title="Administration">${icon('shield-check')}</button>` : ''}
            <button class="icon-button" type="button" data-page="settings" aria-label="Settings" title="Settings">${icon('settings-2')}</button>
            <button class="icon-button" type="button" data-action="signout" aria-label="Sign out" title="Sign out">${icon('log-out')}</button>
          </div>
        </header>
        <main class="content">${content}</main>
      </section>
    </div>`;
  drawIcons();
}

function heading(title, subtitle, actions = '') {
  return `<div class="page-heading"><div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(subtitle)}</p></div><div class="heading-actions">${actions}</div></div>`;
}

function emptyState(title, description, buttonLabel = '', action = '') {
  return `<div class="empty-state"><span>${icon('inbox')}</span><strong>${escapeHTML(title)}</strong><p>${escapeHTML(description)}</p>${buttonLabel ? `<button class="btn btn-secondary" data-action="${action}" type="button">${icon('plus')} ${escapeHTML(buttonLabel)}</button>` : ''}</div>`;
}

function categoryLabel(id) {
  return state.categories.find((category) => category.id === id)?.name ?? 'Uncategorized';
}

function transactionRows(rows, editable = true) {
  if (!rows.length) return `<tr><td colspan="6">${emptyState('No transactions yet', 'Add the income and spending you want to track.', 'Add transaction', 'transaction')}</td></tr>`;
  return rows.map((row) => `<tr>
    <td><div class="category-cell"><span class="category-symbol">${icon(row.transaction_type === 'income' ? 'arrow-down-left' : 'arrow-up-right')}</span><div><strong>${escapeHTML(row.description)}</strong><span>${escapeHTML(categoryLabel(row.category_id))}</span></div></div></td>
    <td><span class="badge ${row.transaction_type}">${row.transaction_type === 'income' ? 'Income' : 'Expense'}</span></td>
    <td>${escapeHTML(row.transaction_date)}</td>
    <td class="amount ${row.transaction_type === 'income' ? 'positive' : ''}">${row.transaction_type === 'income' ? '+' : '-'}${escapeHTML(amountText(row.amount))}</td>
    ${editable ? `<td><div class="row-actions"><button class="icon-button" type="button" data-action="edit-transaction" data-id="${row.id}" aria-label="Edit ${escapeHTML(row.description)}">${icon('pencil')}</button><button class="icon-button" type="button" data-action="delete-transaction" data-id="${row.id}" aria-label="Delete ${escapeHTML(row.description)}">${icon('trash-2')}</button></div></td>` : ''}
  </tr>`).join('');
}

function transactionTable(rows, editable = true) {
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Description</th><th>Type</th><th>Date</th><th>Amount</th>${editable ? '<th><span class="sr-only">Actions</span></th>' : ''}</tr></thead><tbody>${transactionRows(rows, editable)}</tbody></table></div>`;
}

function metric(label, value, detail, glyph, color = '') {
  return `<article class="metric"><div class="metric-top"><span>${escapeHTML(label)}</span><span class="metric-icon">${icon(glyph)}</span></div><div class="metric-value ${color}">${escapeHTML(value)}</div><div class="metric-foot">${escapeHTML(detail)}</div></article>`;
}

function makeChart(monthly) {
  const max = Math.max(1, ...monthly.flatMap((item) => [Number(item.income), Number(item.expenses)]));
  const ticks = [max, max * 0.75, max * 0.5, max * 0.25, 0];
  const axis = ticks.map((value) => `<span>${value === 0 ? '0' : escapeHTML(moneyFormat.format(value).replace(/\.\d+$/, ''))}</span>`).join('');
  const bars = monthly.map((item) => `<div class="chart-group" aria-label="${escapeHTML(displayMonth(item.month))}: income ${escapeHTML(amountText(item.income))}, expenses ${escapeHTML(amountText(item.expenses))}"><span class="chart-bar income" style="height:${Math.max(1, Number(item.income) / max * 100)}%"></span><span class="chart-bar expense" style="height:${Math.max(1, Number(item.expenses) / max * 100)}%"></span></div>`).join('');
  const labels = monthly.map((item) => {
    const month = String(item.month).slice(0, 7);
    return `<span>${escapeHTML(new Intl.DateTimeFormat('en-ZA', { month: 'short' }).format(new Date(`${month}-01T12:00:00`)))}</span>`;
  }).join('');
  const accessibleData = `<div class="sr-only"><table><caption>Monthly income and expenses</caption><thead><tr><th>Month</th><th>Income</th><th>Expenses</th></tr></thead><tbody>${monthly.map((item) => `<tr><th>${escapeHTML(displayMonth(item.month))}</th><td>${escapeHTML(amountText(item.income))}</td><td>${escapeHTML(amountText(item.expenses))}</td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="chart" role="img" aria-label="Monthly income and expenses for the past six months"><div class="chart-axis">${axis}</div><div class="chart-body"><div class="chart-grid">${bars}</div><div class="chart-labels">${labels}</div></div></div>${accessibleData}<div class="legend"><span><i class="dot"></i>Income</span><span><i class="dot expense"></i>Expenses</span></div>`;
}

async function loadWorkspace() {
  state.pageError = '';
  renderFrame('<div class="loading" role="status">Loading your actual records...</div>', { monthPicker: state.page === 'overview' });
  try {
    const monthStart = getMonthStart(state.month);
    const monthEnd = getMonthEnd(state.month);
    const results = await Promise.all([
      api('/profile'),
      api('/categories'),
      api('/transactions?limit=100&sort=transaction_date&direction=desc'),
      api(`/budgets?limit=100&month=${state.month}-01`),
      api('/goals?limit=100'),
      api(`/reports/summary?from=${monthStart}&to=${monthEnd}`),
    ]);
    state.profile = results[0].data;
    state.categories = results[1].data;
    state.transactions = results[2].data;
    state.budgets = results[3].data;
    state.goals = results[4].data;
    state.summary = results[5].data;
    if (state.page === 'overview') await renderOverview();
    else if (state.page === 'transactions') await renderTransactions();
    else if (state.page === 'budgets') renderBudgets();
    else if (state.page === 'goals') renderGoals();
    else if (state.page === 'reports') await renderReports();
    else if (state.page === 'support') await renderSupport();
    else if (state.page === 'settings') renderSettings();
    else if (state.page === 'admin' && state.profile.role === 'admin') await renderAdmin();
    else { state.page = 'overview'; await renderOverview(); }
  } catch (error) {
    state.pageError = error.message;
    renderFrame(`${heading('Something went wrong', 'Your records could not be loaded.')}<section class="panel">${emptyState('Could not load this view', error.message, 'Try again', 'reload')}</section>`);
  }
}

async function renderOverview() {
  const [transactionsResult, chartResult] = await Promise.all([
    api(`/transactions?limit=6&sort=transaction_date&direction=desc&from=${getMonthStart(state.month)}&to=${getMonthEnd(state.month)}`),
    api(`/reports/summary?from=${getMonthStart(addMonths(state.month, -5))}&to=${getMonthEnd(state.month)}`),
  ]);
  const recent = transactionsResult.data;
  state.transactions = recent;
  const budgets = state.budgets;
  const chartData = new Map((chartResult.data.monthly_totals ?? []).map((item) => [item.month.slice(0, 7), item]));
  const chartMonths = Array.from({ length: 6 }, (_, index) => {
    const month = addMonths(state.month, index - 5);
    return chartData.get(month) ?? { month, income: '0.00', expenses: '0.00' };
  });
  const budgetMarkup = budgets.length ? budgets.map((budget) => {
    const spent = state.summary.spending_by_category.find((category) => category.category_id === budget.category_id)?.amount ?? '0.00';
    const percent = Math.round(Number(spent) / Number(budget.amount_limit) * 100);
    const remaining = fromCents(toCents(budget.amount_limit) - toCents(spent));
    const threshold = state.profile.budget_warning_threshold ?? 80;
    return `<div class="budget-item"><div class="budget-title"><strong>${escapeHTML(categoryLabel(budget.category_id))}</strong><span>${escapeHTML(amountText(spent))} / ${escapeHTML(amountText(budget.amount_limit))}</span></div><div class="progress ${percent >= 100 ? 'over' : ''}"><span style="width:${Math.min(100, percent)}%"></span></div><div class="budget-caption"><span>${percent >= threshold ? `Warning at ${threshold}%` : `${escapeHTML(amountText(remaining))} remaining`}</span><span>${percent}%</span></div></div>`;
  }).join('') : emptyState('No monthly budgets', 'Set a category limit to see your spending progress.', 'Create a budget', 'budget');
  const savingsTotal = sumMoney((state.goals ?? []).map((goal) => goal.current_amount));
  const savingsTarget = sumMoney((state.goals ?? []).map((goal) => goal.target_amount));
  renderFrame(`${heading(`Good ${getGreeting()}, ${state.profile.full_name.split(' ')[0]}`, `Your records for ${displayMonth(state.month)}. Calculated from entries you add here.`, `<button class="btn btn-secondary" type="button" data-action="income">${icon('trending-up')}Add income</button><button class="btn btn-primary" type="button" data-action="transaction">${icon('plus')}Add transaction</button>`)}
    <section class="metrics" aria-label="Financial summary">
      ${metric('Recorded balance', amountText(state.summary.balance), 'Calculated, not a bank balance', 'wallet', Number(state.summary.balance) >= 0 ? 'positive' : 'negative')}
      ${metric('Income this month', amountText(state.summary.income), 'Recorded income', 'trending-up', 'positive')}
      ${metric('Expenses this month', amountText(state.summary.expenses), 'Recorded spending', 'trending-down')}
      ${metric('Savings progress', `${amountText(savingsTotal)} / ${amountText(savingsTarget)}`, `${state.goals.length} active ${state.goals.length === 1 ? 'goal' : 'goals'}`, 'target')}
    </section>
    <div class="dashboard-grid">
      <div class="stack">
        <section class="panel"><div class="panel-heading"><div><h2>Income &amp; expenses</h2><p>Recorded monthly totals over the past six months</p></div></div>${makeChart(chartMonths)}</section>
        <section class="panel"><div class="panel-heading"><div><h2>Recent transactions</h2><p>Your latest records for ${escapeHTML(displayMonth(state.month))}</p></div><button class="text-link" type="button" data-page="transactions">All transactions ${icon('arrow-right')}</button></div>${transactionTable(recent)}</section>
      </div>
      <div class="stack">
        <section class="panel"><div class="panel-heading"><div><h2>Budget check-in</h2><p>Limits set for ${escapeHTML(displayMonth(state.month))}</p></div><button class="text-link" type="button" data-page="budgets">View all ${icon('arrow-right')}</button></div><div class="budget-list">${budgetMarkup}</div></section>
        <section class="panel"><div class="panel-heading"><div><h2>Quick actions</h2><p>Keep your plan current</p></div></div><div class="quick-actions"><button class="quick-action" type="button" data-action="transaction"><span>${icon('arrow-left-right')}</span><span><strong>Add transaction</strong><small>Record income or spending</small></span></button><button class="quick-action" type="button" data-action="budget"><span>${icon('chart-pie')}</span><span><strong>Set a budget</strong><small>Plan a category limit</small></span></button><button class="quick-action" type="button" data-action="goal"><span>${icon('target')}</span><span><strong>Create a goal</strong><small>Track what you are saving for</small></span></button></div></section>
      </div>
    </div>`, { monthPicker: true });
}

function getGreeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

async function renderTransactions() {
  const params = new URLSearchParams({ limit: '25', page: String(state.transactionPage), sort: 'transaction_date', direction: 'desc' });
  const currentSearch = document.querySelector('#transaction-search')?.value ?? '';
  const type = document.querySelector('#transaction-type')?.value ?? '';
  const category = document.querySelector('#transaction-category')?.value ?? '';
  const from = document.querySelector('#transaction-from')?.value ?? '';
  const to = document.querySelector('#transaction-to')?.value ?? '';
  const sort = document.querySelector('#transaction-sort')?.value ?? 'transaction_date';
  params.set('sort', sort);
  if (currentSearch) params.set('search', currentSearch);
  if (type) params.set('transaction_type', type);
  if (category) params.set('category_id', category);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const { data, pagination } = await api(`/transactions?${params}`);
  state.transactions = data;
  state.transactionTotal = pagination.total;
  const categories = state.categories.map((item) => `<option value="${item.id}" ${category === item.id ? 'selected' : ''}>${escapeHTML(item.name)}</option>`).join('');
  renderFrame(`${heading('Transactions', 'A searchable record of your personal cash flow.', `<button class="btn btn-primary" data-action="transaction" type="button">${icon('plus')}Add transaction</button>`)}
    <section class="panel">
      <div class="toolbar"><label class="sr-only" for="transaction-search">Search description</label><input class="toolbar-search" id="transaction-search" type="search" placeholder="Search description..." value="${escapeHTML(currentSearch)}"><label class="sr-only" for="transaction-type">Filter by type</label><select id="transaction-type"><option value="">All types</option><option value="income" ${type === 'income' ? 'selected' : ''}>Income</option><option value="expense" ${type === 'expense' ? 'selected' : ''}>Expense</option></select><label class="sr-only" for="transaction-category">Filter by category</label><select id="transaction-category"><option value="">All categories</option>${categories}</select><label class="sr-only" for="transaction-from">From date</label><input id="transaction-from" type="date" value="${escapeHTML(from)}" aria-label="From date"><label class="sr-only" for="transaction-to">To date</label><input id="transaction-to" type="date" value="${escapeHTML(to)}" aria-label="To date"><label class="sr-only" for="transaction-sort">Sort transactions</label><select id="transaction-sort"><option value="transaction_date" ${sort === 'transaction_date' ? 'selected' : ''}>Newest first</option><option value="amount" ${sort === 'amount' ? 'selected' : ''}>Amount</option></select><span class="toolbar-spacer"></span><button class="btn btn-secondary" data-action="export" type="button">${icon('download')}Export CSV</button></div>
      ${data.length ? `${transactionTable(data)}<div class="pagination-controls"><span>Showing ${((state.transactionPage - 1) * 25) + 1}-${((state.transactionPage - 1) * 25) + data.length} of ${pagination.total}</span><div><button class="btn btn-secondary" type="button" data-action="transaction-page" data-page-number="${state.transactionPage - 1}" ${state.transactionPage <= 1 ? 'disabled' : ''}>${icon('chevron-left')}Previous</button><button class="btn btn-secondary" type="button" data-action="transaction-page" data-page-number="${state.transactionPage + 1}" ${state.transactionPage * 25 >= pagination.total ? 'disabled' : ''}>Next${icon('chevron-right')}</button></div></div>` : emptyState('Nothing matches these filters', 'Try another search or add a transaction.', 'Add transaction', 'transaction')}
    </section>`);
}

function renderBudgets() {
  const rows = state.budgets ?? [];
  const content = rows.length ? `<div class="cards-grid">${rows.map((budget) => {
    const spent = state.summary.spending_by_category.find((category) => category.category_id === budget.category_id)?.amount ?? '0.00';
    const percent = Math.round(Number(spent) / Number(budget.amount_limit) * 100);
    const remaining = Number(fromCents(toCents(budget.amount_limit) - toCents(spent)));
    return `<article class="goal-card"><div class="goal-card-head"><div><h3>${escapeHTML(categoryLabel(budget.category_id))}</h3><div class="goal-amount">${escapeHTML(displayMonth(state.month))}</div></div><div class="row-actions"><button class="icon-button" data-action="edit-budget" data-id="${budget.id}" aria-label="Edit budget">${icon('pencil')}</button><button class="icon-button" data-action="delete-budget" data-id="${budget.id}" aria-label="Delete budget">${icon('trash-2')}</button></div></div><div class="goal-amount"><strong>${escapeHTML(amountText(spent))}</strong> of ${escapeHTML(amountText(budget.amount_limit))}</div><div class="progress ${percent >= 100 ? 'over' : ''}"><span style="width:${Math.min(100, percent)}%"></span></div><div class="goal-card-foot"><span>${remaining < 0 ? `${escapeHTML(amountText(Math.abs(remaining)))} over limit` : `${escapeHTML(amountText(remaining))} remaining`}</span><span>${percent}%</span></div>${percent >= 80 ? '<p class="warning" style="margin:12px 0 0">You are nearing or over this category limit.</p>' : ''}</article>`;
  }).join('')}</div>` : emptyState('No budgets for this month', 'Create monthly category limits to see progress and get spending warnings.', 'Create a budget', 'budget');
  renderFrame(`${heading('Budgets', 'Set a monthly limit and see how recorded spending compares.', `<button class="btn btn-primary" data-action="budget" type="button">${icon('plus')}New budget</button>`)}<section class="panel"><div class="panel-heading"><div><h2>${escapeHTML(displayMonth(state.month))}</h2><p>Warnings appear as recorded spending approaches a limit.</p></div></div>${content}</section>`, { monthPicker: true });
}

function renderGoals() {
  const goals = state.goals ?? [];
  const cards = goals.length ? `<div class="cards-grid">${goals.map((goal) => {
    const percent = Math.min(100, Math.round(Number(goal.current_amount) / Number(goal.target_amount) * 100));
    const remaining = Math.max(0, Number(goal.target_amount) - Number(goal.current_amount));
    return `<article class="goal-card"><div class="goal-card-head"><div><span class="category-symbol">${icon('target')}</span></div><div class="row-actions"><button class="icon-button" data-action="edit-goal" data-id="${goal.id}" aria-label="Edit ${escapeHTML(goal.name)}">${icon('pencil')}</button><button class="icon-button" data-action="delete-goal" data-id="${goal.id}" aria-label="Delete ${escapeHTML(goal.name)}">${icon('trash-2')}</button></div></div><h3>${escapeHTML(goal.name)}</h3><div class="goal-amount"><strong>${escapeHTML(amountText(goal.current_amount))}</strong> saved of ${escapeHTML(amountText(goal.target_amount))}</div><div class="progress"><span style="width:${percent}%"></span></div><div class="goal-card-foot"><span>${escapeHTML(amountText(remaining))} to go</span><span>${percent}%${goal.target_date ? ` · ${escapeHTML(goal.target_date)}` : ''}</span></div><button class="text-link" style="margin-top:13px" data-action="update-goal-progress" data-id="${goal.id}" type="button">Update saved amount ${icon('arrow-right')}</button></article>`;
  }).join('')}</div>` : emptyState('No savings goals yet', 'Give a savings plan a name, target and optional date.', 'Create your first goal', 'goal');
  renderFrame(`${heading('Savings goals', 'Build a picture of what you are saving toward.', `<button class="btn btn-primary" data-action="goal" type="button">${icon('plus')}New goal</button>`)}<section class="panel">${cards}</section>`);
}

async function renderReports() {
  const from = getMonthStart(addMonths(state.month, -5));
  const to = getMonthEnd(state.month);
  const [{ data }, monthTransactions] = await Promise.all([
    api(`/reports/summary?from=${from}&to=${to}`),
    api(`/transactions?limit=100&sort=transaction_date&direction=desc&from=${getMonthStart(state.month)}&to=${getMonthEnd(state.month)}`),
  ]);
  const byMonth = new Map((data.monthly_totals ?? []).map((item) => [item.month.slice(0, 7), item]));
  const monthly = Array.from({ length: 6 }, (_, index) => {
    const month = addMonths(state.month, index - 5);
    return byMonth.get(month) ?? { month, income: '0.00', expenses: '0.00' };
  });
  const categories = data.spending_by_category.toSorted((a, b) => Number(b.amount) - Number(a.amount));
  const totalSpending = sumMoney(categories.map((category) => category.amount));
  renderFrame(`${heading('Reports', 'Explore the records you have entered over the last six months.', `<button class="btn btn-secondary" data-action="export" type="button">${icon('download')}Export CSV</button>`)}
    <section class="metrics">${metric('Income', amountText(data.income), `${escapeHTML(from)} to ${escapeHTML(to)}`, 'trending-up', 'positive')}${metric('Expenses', amountText(data.expenses), 'Recorded across selected dates', 'trending-down')}${metric('Difference', amountText(sumMoney([data.income, `-${data.expenses}`])), 'Period income minus expenses', 'scale')}${metric('Categories', String(categories.length), 'With recorded spending', 'shapes')}</section>
    <div class="dashboard-grid"><section class="panel"><div class="panel-heading"><div><h2>Monthly comparison</h2><p>Recorded income and spending, by month</p></div></div>${makeChart(monthly)}</section>
    <section class="panel"><div class="panel-heading"><div><h2>Spending by category</h2><p>${escapeHTML(amountText(totalSpending))} total in selected period</p></div></div>${categories.length ? `<div class="budget-list">${categories.map((category) => { const percent = Number(totalSpending) ? Math.round(Number(category.amount) / Number(totalSpending) * 100) : 0; return `<div class="budget-item"><div class="budget-title"><strong>${escapeHTML(category.category)}</strong><span>${escapeHTML(amountText(category.amount))}</span></div><div class="progress"><span style="width:${percent}%"></span></div><div class="budget-caption"><span>${percent}% of spending</span></div></div>`; }).join('')}</div>` : emptyState('No spending to report', 'Expense category totals will appear here after you record expenses.')}</section></div>
    <section class="panel" style="margin-top:14px"><div class="panel-heading"><div><h2>Transactions in ${escapeHTML(displayMonth(state.month))}</h2><p>Actual records only. Nothing is estimated.</p></div></div>${transactionTable(monthTransactions.data, false)}</section>`, { monthPicker: true });
}

async function renderSupport() {
  const { data } = await api('/support-requests?limit=100&sort=created_at&direction=desc');
  const rows = data.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Subject</th><th>Submitted</th><th>Status</th></tr></thead><tbody>${data.map((request) => `<tr><td>${escapeHTML(request.subject)}</td><td>${escapeHTML(new Date(request.created_at).toLocaleDateString('en-ZA'))}</td><td><span class="badge">${escapeHTML(request.status.replace('_', ' '))}</span></td></tr>`).join('')}</tbody></table></div>` : emptyState('No support requests', 'Create a request if you need help with your account.', 'New request', 'support-request');
  renderFrame(`${heading('Support', 'Requests you submit are visible only to you and authorized support administrators.', `<button class="btn btn-primary" data-action="support-request" type="button">${icon('plus')}New request</button>`)}<section class="panel">${rows}</section>`);
}

function renderSettings() {
  renderFrame(`${heading('Settings', 'Manage your profile and account session.')}
    <div class="settings-grid"><section class="panel"><div class="panel-heading"><div><h2>Profile</h2><p>Update your display name and budget warning level.</p></div></div><form id="profile-form"><div class="field"><label for="profile-name">Full name</label><input id="profile-name" name="full_name" value="${escapeHTML(state.profile.full_name)}" maxlength="100" required></div><div class="field"><label for="warning-threshold">Budget warning threshold</label><input id="warning-threshold" name="budget_warning_threshold" type="number" min="1" max="100" step="1" value="${state.profile.budget_warning_threshold ?? 80}" required><span class="field-hint">Warn when recorded category spending reaches this percentage of the limit.</span></div><dl class="settings-details"><dt>Account email</dt><dd>${escapeHTML(state.session.user.email)}</dd><dt>Account type</dt><dd>${state.profile.role === 'admin' ? 'Administrator' : 'Personal account'}</dd><dt>Profile created</dt><dd>${escapeHTML(new Date(state.profile.created_at).toLocaleDateString('en-ZA'))}</dd></dl><p class="form-message" role="alert"></p><button class="btn btn-primary" type="submit">${icon('save')}Save profile</button></form></section>
    <section class="panel"><div class="panel-heading"><div><h2>Account session</h2><p>Sign out of this browser session.</p></div></div><div class="warning">Your recorded balance is calculated from entries in BudgetBuddy and is not verified against a bank account.</div><button class="btn btn-secondary" style="margin-top:15px" type="button" data-action="signout">${icon('log-out')}Sign out</button></section></div>`);
}

async function renderAdmin() {
  const [statsResult, requestsResult] = await Promise.all([
    api('/admin/stats'),
    api('/admin/support-requests?limit=100&page=1'),
  ]);
  const statusChoices = ['open', 'in_progress', 'resolved', 'closed'];
  const requestRows = requestsResult.data.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Subject</th><th>Message</th><th>Status</th><th>Update</th></tr></thead><tbody>${requestsResult.data.map((request) => `<tr><td>${escapeHTML(request.subject)}</td><td>${escapeHTML(request.message.slice(0, 120))}</td><td><span class="badge">${escapeHTML(request.status.replace('_', ' '))}</span></td><td><label class="sr-only" for="status-${request.id}">Request status</label><select class="filter-select" data-action="support-status" data-id="${request.id}" id="status-${request.id}">${statusChoices.map((status) => `<option value="${status}" ${status === request.status ? 'selected' : ''}>${status.replace('_', ' ')}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div>` : emptyState('No support requests', 'New authenticated requests will appear here.');
  const categoryItems = state.categories.map((category) => `<div class="category-card" style="display:flex;justify-content:space-between;align-items:center;gap:10px"><div><h3>${escapeHTML(category.name)}</h3><span class="badge ${category.transaction_type}">${category.transaction_type}</span></div><div class="row-actions"><button class="icon-button" data-action="edit-category" data-id="${category.id}" aria-label="Edit category ${escapeHTML(category.name)}">${icon('pencil')}</button><button class="icon-button" data-action="delete-category" data-id="${category.id}" aria-label="Delete category ${escapeHTML(category.name)}">${icon('trash-2')}</button></div></div>`).join('');
  renderFrame(`${heading('Administration', 'Application-wide category controls and non-sensitive support totals.')}
    <section class="metrics">${metric('Categories', String(statsResult.data.category_count), 'Shared category records', 'shapes')}${Object.entries(statsResult.data.support_requests_by_status).map(([status, total]) => metric(`Requests ${status.replace('_', ' ')}`, String(total), 'Current system count', 'messages-square')).join('')}</section>
    <div class="stack"><section class="panel"><div class="panel-heading"><div><h2>Transaction categories</h2><p>Shared categories available to all users</p></div><button class="btn btn-primary" data-action="category" type="button">${icon('plus')}Add category</button></div><div class="cards-grid">${categoryItems || emptyState('No categories', 'Add a category for users to select.')}</div></section><section class="panel"><div class="panel-heading"><div><h2>Support requests</h2><p>Messages are limited to support administration.</p></div></div>${requestRows}</section></div>`);
}

function categoryOptions(type, selected = '') {
  return state.categories.filter((category) => !type || category.transaction_type === type)
    .map((category) => `<option value="${category.id}" ${selected === category.id ? 'selected' : ''}>${escapeHTML(category.name)}</option>`).join('');
}

function openModal(title, description, fields, submitLabel = 'Save') {
  modal.innerHTML = `<div class="modal-head"><div><h2 id="modal-title">${escapeHTML(title)}</h2><p>${escapeHTML(description)}</p></div><button class="icon-button" type="button" data-action="close-modal" aria-label="Close dialog">${icon('x')}</button></div><form class="modal-form" id="record-form" novalidate><div class="form-grid">${fields}</div><p class="form-message" role="alert"></p><div class="modal-actions"><button class="btn btn-secondary" type="button" data-action="close-modal">Cancel</button><button class="btn btn-primary" type="submit">${icon('save')}${escapeHTML(submitLabel)}</button></div></form>`;
  drawIcons();
  modal.showModal();
}

function transactionForm(record = {}) {
  const type = record.transaction_type ?? 'expense';
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = today.slice(0, 7);
  const defaultDate = state.month === currentMonth ? today : `${state.month}-01`;
  const title = record.id ? 'Edit transaction' : type === 'income' ? 'Add income' : 'Add transaction';
  const description = type === 'income' ? `Record income for ${displayMonth(state.month)}.` : 'Record income or spending in your BudgetBuddy account.';
  openModal(title, description, `
    <div class="field full"><label for="description">Description</label><input id="description" name="description" required maxlength="240" value="${escapeHTML(record.description ?? '')}" placeholder="e.g. Weekly groceries"></div>
    <div class="field"><label for="transaction-type-field">Type</label><select id="transaction-type-field" name="transaction_type"><option value="expense" ${type === 'expense' ? 'selected' : ''}>Expense</option><option value="income" ${type === 'income' ? 'selected' : ''}>Income</option></select></div>
    <div class="field"><label for="amount">Amount (ZAR)</label><input id="amount" name="amount" inputmode="decimal" pattern="[0-9]+(\\.[0-9]{1,2})?" min="0.01" step="0.01" required value="${escapeHTML(record.amount ?? '')}" placeholder="0.00"></div>
    <div class="field"><label for="category-id">Category</label><select id="category-id" name="category_id"><option value="">Uncategorized</option>${categoryOptions(type, record.category_id ?? '')}</select></div>
    <div class="field"><label for="transaction-date">Date</label><input id="transaction-date" name="transaction_date" type="date" required value="${escapeHTML(record.transaction_date ?? defaultDate)}"></div>`, 'Save transaction');
  modal.dataset.recordId = record.id ?? '';
  modal.dataset.recordType = 'transaction';
}

function budgetForm(record = {}) {
  const categoryIds = new Set((state.categories ?? []).filter((category) => category.transaction_type === 'expense').map((category) => category.id));
  const budgetsWithoutCurrent = (state.budgets ?? []).filter((budget) => budget.id !== record.id).map((budget) => budget.category_id);
  const available = state.categories.filter((category) => category.transaction_type === 'expense' && (!budgetsWithoutCurrent.includes(category.id) || category.id === record.category_id));
  openModal(record.id ? 'Edit budget' : 'Create monthly budget', 'A budget belongs to one expense category and one month.', `
    <div class="field full"><label for="budget-category">Category</label><select id="budget-category" name="category_id" required><option value="">Choose a category</option>${available.filter((category) => categoryIds.has(category.id)).map((category) => `<option value="${category.id}" ${record.category_id === category.id ? 'selected' : ''}>${escapeHTML(category.name)}</option>`).join('')}</select></div>
    <div class="field"><label for="budget-amount">Monthly limit (ZAR)</label><input id="budget-amount" name="amount_limit" inputmode="decimal" min="0.01" step="0.01" required value="${escapeHTML(record.amount_limit ?? '')}" placeholder="0.00"></div>
    <div class="field"><label for="budget-month">Month</label><input id="budget-month" type="month" required value="${escapeHTML((record.budget_month ?? `${state.month}-01`).slice(0, 7))}"></div>`, 'Save budget');
  modal.dataset.recordId = record.id ?? '';
  modal.dataset.recordType = 'budget';
}

function goalForm(record = {}, progressOnly = false) {
  openModal(progressOnly ? 'Update savings progress' : record.id ? 'Edit savings goal' : 'Create savings goal', 'Goal amounts are entered in South African rand.', `
    ${progressOnly ? '' : `<div class="field full"><label for="goal-name">Goal name</label><input id="goal-name" name="name" maxlength="100" required value="${escapeHTML(record.name ?? '')}" placeholder="e.g. Emergency fund"></div>`}
    ${progressOnly ? '' : `<div class="field"><label for="goal-target">Target amount (ZAR)</label><input id="goal-target" name="target_amount" inputmode="decimal" min="0.01" step="0.01" required value="${escapeHTML(record.target_amount ?? '')}"></div>`}
    <div class="field"><label for="goal-current">${progressOnly ? 'Total saved so far' : 'Current saved amount'} (ZAR)</label><input id="goal-current" name="current_amount" inputmode="decimal" min="0" step="0.01" required value="${escapeHTML(record.current_amount ?? '0.00')}"></div>
    ${progressOnly ? '' : `<div class="field"><label for="goal-date">Target date <span class="field-hint">Optional</span></label><input id="goal-date" name="target_date" type="date" value="${escapeHTML(record.target_date ?? '')}"></div>`}`, 'Save goal');
  modal.dataset.recordId = record.id ?? '';
  modal.dataset.recordType = 'goal';
}

function supportForm() {
  openModal('New support request', 'Only you and authorized support administrators can view this request.', `
    <div class="field full"><label for="support-subject">Subject</label><input id="support-subject" name="subject" maxlength="120" required minlength="3" placeholder="What do you need help with?"></div>
    <div class="field full"><label for="support-message">Message</label><textarea id="support-message" name="message" maxlength="5000" minlength="10" required placeholder="Describe the issue. Please do not include passwords or bank details."></textarea></div>`, 'Submit request');
  modal.dataset.recordType = 'support';
}

function categoryForm(record = {}) {
  openModal(record.id ? 'Edit transaction category' : 'Add transaction category', 'This category will be visible to every account.', `
    <div class="field full"><label for="category-name">Category name</label><input id="category-name" name="name" maxlength="60" required value="${escapeHTML(record.name ?? '')}"></div>
    <div class="field full"><label for="category-type">Category type</label><select id="category-type" name="transaction_type"><option value="expense" ${record.transaction_type === 'expense' || !record.transaction_type ? 'selected' : ''}>Expense</option><option value="income" ${record.transaction_type === 'income' ? 'selected' : ''}>Income</option></select></div>`, record.id ? 'Save category' : 'Add category');
  modal.dataset.recordType = 'category';
  modal.dataset.recordId = record.id ?? '';
}

async function submitRecord(form) {
  const type = modal.dataset.recordType;
  const recordId = modal.dataset.recordId;
  const values = Object.fromEntries(new FormData(form).entries());
  if (type === 'budget') values.budget_month = `${document.querySelector('#budget-month').value}-01`;
  if (type === 'goal' && !values.target_date) values.target_date = null;
  if (type === 'transaction' && !values.category_id) values.category_id = null;
  if (type === 'goal' && !values.current_amount) values.current_amount = '0.00';
  if (type === 'goal' && recordId && !values.target_date) values.target_date = null;

  if (type === 'transaction' && values.amount && !/^[0-9]{1,10}(\.[0-9]{1,2})?$/.test(values.amount)) throw new Error('Enter a positive amount with up to two decimal places.');
  if (type === 'budget' && values.amount_limit && !/^[0-9]{1,10}(\.[0-9]{1,2})?$/.test(values.amount_limit)) throw new Error('Enter a positive limit with up to two decimal places.');
  if (type === 'goal') {
    if (values.target_amount && !/^[0-9]{1,10}(\.[0-9]{1,2})?$/.test(values.target_amount)) throw new Error('Enter a positive goal target with up to two decimal places.');
    if (values.current_amount && !/^[0-9]{1,10}(\.[0-9]{1,2})?$/.test(values.current_amount)) throw new Error('Enter a non-negative saved amount with up to two decimal places.');
  }

  const routes = { transaction: '/transactions', budget: '/budgets', goal: '/goals', support: '/support-requests', category: '/categories' };
  const path = routes[type];
  const method = recordId ? 'PATCH' : 'POST';
  const result = await api(`${path}${recordId ? `/${recordId}` : ''}`, apiJSON(method, values));
  modal.close();
  toast(type === 'support' ? 'Your request was submitted.' : recordId ? 'Changes saved.' : 'Record created.');
  if (type === 'transaction' && result?.data?.id && !recordId) {
    const transactionMonth = result.data.transaction_date.slice(0, 7);
    if (transactionMonth !== state.month) state.month = transactionMonth;
  }
  await loadWorkspace();
}

async function deleteRecord(type, id) {
  const collection = { transaction: state.transactions, budget: state.budgets, goal: state.goals, category: state.categories }[type] ?? [];
  const record = collection.find((item) => item.id === id);
  const label = record?.description ?? record?.name ?? categoryLabel(record?.category_id) ?? 'this record';
  if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
  await api(`/${type === 'goal' ? 'goals' : type === 'category' ? 'categories' : `${type}s`}/${id}`, { method: 'DELETE' });
  toast('Record deleted.');
  await loadWorkspace();
}

async function exportCSV() {
  const from = getMonthStart(addMonths(state.month, -5));
  const to = getMonthEnd(state.month);
  let page = 1;
  let rows = [];
  while (true) {
    const result = await api(`/transactions?limit=100&page=${page}&sort=transaction_date&direction=desc&from=${from}&to=${to}`);
    rows = rows.concat(result.data);
    if (rows.length >= result.pagination.total || !result.data.length) break;
    page += 1;
  }
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const output = [['date', 'type', 'category', 'description', 'amount ZAR'], ...rows.map((row) => [row.transaction_date, row.transaction_type, categoryLabel(row.category_id), row.description, row.amount])]
    .map((row) => row.map(quote).join(',')).join('\r\n');
  const blob = new Blob([output], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `budgetbuddy-transactions-${state.month}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  toast(`Exported ${rows.length} records.`);
}

async function refreshForPage() {
  try {
    if (state.page === 'transactions') await renderTransactions();
    else await loadWorkspace();
  } catch (error) {
    toast(error.message, 'error');
  }
}

document.addEventListener('click', async (event) => {
  const modeButton = event.target.closest('[data-auth-mode]');
  if (modeButton) { state.authMode = modeButton.dataset.authMode; renderAuth(); return; }

  const pageButton = event.target.closest('[data-page]');
  if (pageButton) {
    state.page = pageButton.dataset.page;
    await refreshForPage();
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  try {
    const { action, id } = actionButton.dataset;
    if (action === 'close-modal') modal.close();
    else if (action === 'income') transactionForm({ transaction_type: 'income' });
    else if (action === 'transaction') transactionForm();
    else if (action === 'budget') budgetForm();
    else if (action === 'goal') goalForm();
    else if (action === 'support-request') supportForm();
    else if (action === 'category') categoryForm();
    else if (action === 'edit-category') categoryForm(state.categories.find((category) => category.id === id));
    else if (action === 'reload') await loadWorkspace();
    else if (action === 'export') await exportCSV();
    else if (action === 'transaction-page') {
      state.transactionPage = Number(actionButton.dataset.pageNumber);
      await renderTransactions();
    }
    else if (action === 'signout') await supabaseClient.auth.signOut();
    else if (action === 'delete-transaction') await deleteRecord('transaction', id);
    else if (action === 'delete-budget') await deleteRecord('budget', id);
    else if (action === 'delete-goal') await deleteRecord('goal', id);
    else if (action === 'delete-category') await deleteRecord('category', id);
    else if (action === 'edit-transaction') transactionForm(state.transactions.find((row) => row.id === id));
    else if (action === 'edit-budget') budgetForm(state.budgets.find((row) => row.id === id));
    else if (action === 'edit-goal') goalForm(state.goals.find((row) => row.id === id));
    else if (action === 'update-goal-progress') goalForm(state.goals.find((row) => row.id === id), true);
  } catch (error) {
    toast(error.message, 'error');
  }
});

document.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  if (form.id === 'auth-form') {
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    if (state.authMode === 'register') {
      if (values.password.length < 10 || !/[a-z]/.test(values.password) || !/[A-Z]/.test(values.password) || !/[0-9]/.test(values.password)) {
        renderAuth('Use at least 10 characters with uppercase, lowercase, and a number.');
        return;
      }
    }
    state.busy = true;
    renderAuth();
    try {
      const response = await fetch(`${apiBase}/api/auth/${state.authMode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        const serverMessage = result?.error?.fields?.map((field) => `${field.field}: ${field.message}`).join(' ')
          || result?.error?.message;
        throw new Error(serverMessage || `Authentication endpoint returned HTTP ${response.status}. Check the API URL and server configuration.`);
      }
      if (!result?.data || typeof result.data !== 'object') {
        throw new Error('The authentication server returned an unexpected response. Check that the API URL points to BudgetBuddy.');
      }
      if (!result.data.session) {
        state.busy = false;
        renderAuth('Check your inbox to confirm your email, then sign in.');
      } else {
        const { error } = await supabaseClient.auth.setSession(result.data.session);
        if (error) throw new Error(error.message || 'Supabase returned a session that could not be established. Check the project URL and publishable key.');
      }
    } catch (error) {
      state.busy = false;
      const message = error instanceof TypeError
        ? `Could not reach the BudgetBuddy API at ${apiBase || window.location.origin}. In another PowerShell terminal, run "npm.cmd run dev".`
        : error.message || 'Authentication failed. Please try again.';
      renderAuth(message);
    }
    return;
  }

  if (form.id === 'profile-form') {
    if (!form.reportValidity()) return;
    try {
      await api('/profile', apiJSON('PATCH', Object.fromEntries(new FormData(form).entries())));
      toast('Profile updated.');
      await loadWorkspace();
    } catch (error) {
      form.querySelector('.form-message').textContent = error.message;
    }
    return;
  }

  if (form.id === 'record-form') {
    if (!form.reportValidity()) return;
    const message = form.querySelector('.form-message');
    try {
      await submitRecord(form);
    } catch (error) {
      message.textContent = error.message;
    }
  }
});

document.addEventListener('change', async (event) => {
  if (event.target.id === 'active-month') {
    state.month = event.target.value;
    await loadWorkspace();
  } else if (['transaction-type', 'transaction-category', 'transaction-from', 'transaction-to', 'transaction-sort'].includes(event.target.id)) {
    state.transactionPage = 1;
    await renderTransactions().catch((error) => toast(error.message, 'error'));
  } else if (event.target.id === 'transaction-date') {
    event.target.closest('#record-form').elements.transaction_date.value = event.target.value;
  } else if (event.target.matches('[data-action="support-status"]')) {
    const id = event.target.dataset.id;
    try {
      await api(`/admin/support-requests/${id}`, apiJSON('PATCH', { status: event.target.value }));
      toast('Request status updated.');
      await renderAdmin();
    } catch (error) {
      toast(error.message, 'error');
    }
  }
});

let searchTimer;
document.addEventListener('input', (event) => {
  if (event.target.id === 'transaction-search') {
    state.transactionPage = 1;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(async () => {
      try {
        const cursor = event.target.selectionStart;
        await renderTransactions();
        const search = document.querySelector('#transaction-search');
        search?.focus();
        search?.setSelectionRange(cursor, cursor);
      } catch (error) {
        toast(error.message, 'error');
      }
    }, 250);
  }
  if (event.target.id === 'transaction-type-field') {
    const category = document.querySelector('#category-id');
    const previous = category.value;
    category.innerHTML = `<option value="">Uncategorized</option>${categoryOptions(event.target.value, previous)}`;
  }
});

function start() {
  if (!supabaseClient) {
    renderAuth();
    return;
  }
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(async () => {
      state.session = session;
      if (session) await loadWorkspace();
      else renderAuth();
    }, 0);
  });
}

start();