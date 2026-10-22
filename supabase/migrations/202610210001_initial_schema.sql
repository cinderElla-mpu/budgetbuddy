create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null check (char_length(full_name) between 1 and 100),
  role text not null default 'user' check (role in ('user', 'admin')),
  budget_warning_threshold integer not null default 80 check (budget_warning_threshold between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.prevent_profile_role_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null then
    raise exception 'Profile roles can only be changed by a trusted administrator';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_role_change
before update on public.profiles
for each row execute function public.prevent_profile_role_change();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  supplied_name text;
begin
  supplied_name := nullif(trim(new.raw_user_meta_data ->> 'full_name'), '');
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(left(supplied_name, 100), 'BudgetBuddy user')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  transaction_type text not null check (transaction_type in ('income', 'expense')),
  created_at timestamptz not null default now(),
  unique (name, transaction_type)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  transaction_type text not null check (transaction_type in ('income', 'expense')),
  amount numeric(12, 2) not null check (amount > 0),
  description text not null check (char_length(description) between 1 and 240),
  transaction_date date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index transactions_user_date_idx
  on public.transactions (user_id, transaction_date desc);
create index transactions_user_type_date_idx
  on public.transactions (user_id, transaction_type, transaction_date desc);
create index transactions_category_idx
  on public.transactions (category_id);

create or replace function public.validate_transaction_category_type()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  category_type text;
begin
  if new.category_id is not null then
    select transaction_type into category_type
    from public.categories where id = new.category_id;
    if category_type is distinct from new.transaction_type then
      raise exception 'Transaction type must match its category' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger transactions_validate_category_type
before insert or update of category_id, transaction_type on public.transactions
for each row execute function public.validate_transaction_category_type();

create trigger transactions_set_updated_at
before update on public.transactions
for each row execute function public.set_updated_at();

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category_id uuid not null references public.categories (id) on delete restrict,
  amount_limit numeric(12, 2) not null check (amount_limit > 0),
  budget_month date not null check (
    budget_month = date_trunc('month', budget_month::timestamp)::date
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, category_id, budget_month)
);

create index budgets_user_month_idx on public.budgets (user_id, budget_month);

create or replace function public.validate_budget_category_type()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.categories
    where id = new.category_id and transaction_type = 'expense'
  ) then
    raise exception 'Budgets require an expense category' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger budgets_validate_category_type
before insert or update of category_id on public.budgets
for each row execute function public.validate_budget_category_type();

create trigger budgets_set_updated_at
before update on public.budgets
for each row execute function public.set_updated_at();

create table public.savings_goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  target_amount numeric(12, 2) not null check (target_amount > 0),
  current_amount numeric(12, 2) not null default 0 check (current_amount >= 0),
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index savings_goals_user_idx on public.savings_goals (user_id);
create trigger savings_goals_set_updated_at
before update on public.savings_goals
for each row execute function public.set_updated_at();

create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null check (char_length(subject) between 3 and 120),
  message text not null check (char_length(message) between 10 and 5000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index support_requests_user_created_idx
  on public.support_requests (user_id, created_at desc);
create trigger support_requests_set_updated_at
before update on public.support_requests
for each row execute function public.set_updated_at();

create or replace function public.prevent_category_type_change_in_use()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.transaction_type is distinct from old.transaction_type and (
    exists (select 1 from public.transactions where category_id = old.id)
    or exists (select 1 from public.budgets where category_id = old.id)
  ) then
    raise exception 'A category type cannot change while it is in use' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger categories_prevent_type_change_in_use
before update of transaction_type on public.categories
for each row execute function public.prevent_category_type_change_in_use();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.savings_goals enable row level security;
alter table public.support_requests enable row level security;

create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);
create policy "Users can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Column-level grants keep role and identity fields out of user updates.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, budget_warning_threshold) on public.profiles to authenticated;

grant select on public.categories to authenticated;
grant insert, update, delete on public.categories to authenticated;
create policy "Authenticated users can read categories"
  on public.categories for select to authenticated using (true);
create policy "Admins can manage categories"
  on public.categories for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

grant select, insert, update, delete on public.transactions to authenticated;
create policy "Users can read their own transactions"
  on public.transactions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their own transactions"
  on public.transactions for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their own transactions"
  on public.transactions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their own transactions"
  on public.transactions for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.budgets to authenticated;
create policy "Users can manage their own budgets"
  on public.budgets for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.savings_goals to authenticated;
create policy "Users can manage their own savings goals"
  on public.savings_goals for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.support_requests to authenticated;
create policy "Users can read their own support requests"
  on public.support_requests for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create open support requests for themselves"
  on public.support_requests for insert to authenticated
  with check ((select auth.uid()) = user_id and status = 'open');
create policy "Admins can manage support requests"
  on public.support_requests for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create or replace function public.get_financial_report(p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with all_totals as (
    select
      coalesce(sum(amount) filter (where transaction_type = 'income'), 0) as income,
      coalesce(sum(amount) filter (where transaction_type = 'expense'), 0) as expenses
    from public.transactions
  ),
  period_totals as (
    select
      coalesce(sum(amount) filter (where transaction_type = 'income'), 0) as income,
      coalesce(sum(amount) filter (where transaction_type = 'expense'), 0) as expenses
    from public.transactions
    where transaction_date between p_from and p_to
  ),
  category_totals as (
    select t.category_id, coalesce(c.name, 'Uncategorized') as category, sum(t.amount) as amount
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    where t.transaction_date between p_from and p_to
      and t.transaction_type = 'expense'
    group by t.category_id, c.name
  ),
  monthly_totals as (
    select date_trunc('month', transaction_date)::date as month,
      coalesce(sum(amount) filter (where transaction_type = 'income'), 0) as income,
      coalesce(sum(amount) filter (where transaction_type = 'expense'), 0) as expenses
    from public.transactions
    where transaction_date between p_from and p_to
    group by date_trunc('month', transaction_date)::date
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'balance', (all_totals.income - all_totals.expenses)::text,
    'income', period_totals.income::text,
    'expenses', period_totals.expenses::text,
    'spending_by_category', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category_id', category_totals.category_id,
        'category', category_totals.category,
        'amount', category_totals.amount::text
      ) order by category_totals.amount desc)
      from category_totals
    ), '[]'::jsonb),
    'monthly_totals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', monthly_totals.month,
        'income', monthly_totals.income::text,
        'expenses', monthly_totals.expenses::text
      ) order by monthly_totals.month)
      from monthly_totals
    ), '[]'::jsonb)
  )
  from all_totals, period_totals;
$$;

revoke all on function public.get_financial_report(date, date) from public, anon;
grant execute on function public.get_financial_report(date, date) to authenticated;

insert into public.categories (name, transaction_type) values
  ('Salary', 'income'),
  ('Freelance', 'income'),
  ('Investments', 'income'),
  ('Other income', 'income'),
  ('Housing', 'expense'),
  ('Groceries', 'expense'),
  ('Transport', 'expense'),
  ('Utilities', 'expense'),
  ('Healthcare', 'expense'),
  ('Education', 'expense'),
  ('Entertainment', 'expense'),
  ('Dining', 'expense'),
  ('Other expense', 'expense')
on conflict (name, transaction_type) do nothing;
