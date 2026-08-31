-- Aurevion: esquema financeiro compartilhado e seguro.
-- Valores monetarios sao inteiros em centavos. Todas as datas de negocio usam timestamptz/date.

create extension if not exists pgcrypto;

create type public.household_role as enum ('owner', 'member');
create type public.member_status as enum ('invited', 'active', 'suspended');
create type public.account_kind as enum ('checking', 'savings', 'wallet', 'cash', 'investment');
create type public.transaction_kind as enum ('income', 'expense', 'internal_transfer', 'card_purchase', 'card_payment', 'debt_payment', 'adjustment');
create type public.transaction_status as enum ('pending', 'posted', 'void');
create type public.payment_method as enum ('pix', 'credit_card', 'debit_card', 'cash', 'transfer', 'bank_slip', 'other');
create type public.statement_status as enum ('open', 'closed', 'partially_paid', 'paid', 'overdue');
create type public.schedule_status as enum ('active', 'paused', 'completed');
create type public.debt_status as enum ('active', 'paid', 'cancelled');
create type public.notification_kind as enum ('bill_due', 'statement_closing', 'budget_limit', 'new_transaction', 'security');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  avatar_path text,
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.household_role not null default 'member',
  status public.member_status not null default 'active',
  invited_by uuid references public.profiles(id),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  icon text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (household_id, name)
);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  name text not null check (char_length(name) between 1 and 80),
  institution text not null check (char_length(institution) between 1 and 80),
  kind public.account_kind not null,
  opening_balance_cents bigint not null default 0,
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  note text check (note is null or char_length(note) <= 500),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.credit_cards (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  name text not null check (char_length(name) between 1 and 80),
  institution text not null check (char_length(institution) between 1 and 80),
  last_four char(4) check (last_four is null or last_four ~ '^[0-9]{4}$'),
  limit_cents bigint not null check (limit_cents > 0),
  additional_limit_cents bigint not null default 0 check (additional_limit_cents >= 0),
  closing_day smallint not null check (closing_day between 1 and 31),
  due_day smallint not null check (due_day between 1 and 31),
  is_active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.card_statements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  card_id uuid not null references public.credit_cards(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  closing_date date not null,
  due_date date not null,
  amount_paid_cents bigint not null default 0 check (amount_paid_cents >= 0),
  status public.statement_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (card_id, closing_date),
  check (period_start <= period_end and closing_date <= due_date)
);

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kind public.transaction_kind not null,
  status public.transaction_status not null default 'posted',
  amount_cents bigint not null check (amount_cents > 0),
  currency char(3) not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  description text not null check (char_length(description) between 1 and 240),
  note text check (note is null or char_length(note) <= 2000),
  category_id uuid references public.categories(id),
  payment_method public.payment_method not null,
  source_account_id uuid references public.accounts(id),
  destination_account_id uuid references public.accounts(id),
  card_id uuid references public.credit_cards(id),
  statement_id uuid references public.card_statements(id),
  created_by uuid not null references public.profiles(id),
  occurred_at timestamptz not null,
  idempotency_key uuid not null,
  is_recurring boolean not null default false,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (household_id, idempotency_key),
  check (
    (kind = 'internal_transfer' and source_account_id is not null and destination_account_id is not null and source_account_id <> destination_account_id)
    or kind <> 'internal_transfer'
  ),
  check ((kind = 'card_purchase' and card_id is not null and statement_id is not null) or kind <> 'card_purchase')
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  amount_cents bigint not null check (amount_cents <> 0),
  created_at timestamptz not null default now(),
  unique (transaction_id, account_id)
);

create table public.statement_payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  statement_id uuid not null references public.card_statements(id) on delete restrict,
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  paid_at timestamptz not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.scheduled_expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  amount_cents bigint not null check (amount_cents > 0),
  category_id uuid references public.categories(id),
  default_account_id uuid references public.accounts(id),
  default_card_id uuid references public.credit_cards(id),
  due_date date not null,
  recurrence_rule text check (recurrence_rule is null or char_length(recurrence_rule) <= 300),
  status public.schedule_status not null default 'active',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (not (default_account_id is not null and default_card_id is not null))
);

create table public.debts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  creditor text not null check (char_length(creditor) between 1 and 120),
  description text,
  original_amount_cents bigint not null check (original_amount_cents > 0),
  status public.debt_status not null default 'active',
  due_date date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.debt_payments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  debt_id uuid not null references public.debts(id) on delete restrict,
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  paid_at timestamptz not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  category_id uuid not null references public.categories(id),
  month date not null check (extract(day from month) = 1),
  limit_cents bigint not null check (limit_cents > 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, category_id, month)
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  storage_path text not null check (char_length(storage_path) between 1 and 500),
  original_name text not null check (char_length(original_name) between 1 and 200),
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes bigint not null check (size_bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (household_id, storage_path)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind public.notification_kind not null,
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 500),
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.notification_preferences (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  bill_due boolean not null default true,
  statement_closing boolean not null default true,
  budget_limit boolean not null default true,
  new_transaction boolean not null default true,
  security boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete restrict,
  actor_id uuid references public.profiles(id),
  action text not null,
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_hash text not null,
  model text not null,
  prompt_tokens integer check (prompt_tokens is null or prompt_tokens >= 0),
  completion_tokens integer check (completion_tokens is null or completion_tokens >= 0),
  status text not null check (status in ('success', 'rejected', 'error')),
  created_at timestamptz not null default now()
);

create index household_members_user_idx on public.household_members(user_id, status);
create index accounts_household_owner_idx on public.accounts(household_id, owner_id) where archived_at is null;
create index cards_household_owner_idx on public.credit_cards(household_id, owner_id) where archived_at is null;
create index statements_card_due_idx on public.card_statements(card_id, due_date desc);
create index transactions_household_occurred_idx on public.transactions(household_id, occurred_at desc) where deleted_at is null;
create index transactions_household_category_idx on public.transactions(household_id, category_id, occurred_at desc) where deleted_at is null;
create index transactions_statement_idx on public.transactions(statement_id) where statement_id is not null and deleted_at is null;
create index ledger_entries_account_idx on public.ledger_entries(account_id, created_at);
create index upcoming_household_due_idx on public.scheduled_expenses(household_id, due_date) where deleted_at is null and status = 'active';
create index debts_household_status_idx on public.debts(household_id, status) where deleted_at is null;
create index notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;
create index audit_household_record_idx on public.audit_logs(household_id, table_name, record_id, created_at desc);
create index ai_usage_rate_idx on public.ai_usage(user_id, created_at desc);

create schema if not exists app_private;
revoke all on schema app_private from public;
grant usage on schema app_private to authenticated;

create or replace function app_private.is_household_member(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.household_members hm
    where hm.household_id = target_household
      and hm.user_id = auth.uid()
      and hm.status = 'active'
  );
$$;

create or replace function app_private.is_household_owner(target_household uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.household_members hm
    where hm.household_id = target_household
      and hm.user_id = auth.uid()
      and hm.status = 'active'
      and hm.role = 'owner'
  );
$$;

create or replace function app_private.assert_household_member(target_household uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or not app_private.is_household_member(target_household) then
    raise exception 'household_access_denied' using errcode = '42501';
  end if;
end;
$$;

revoke all on all functions in schema app_private from public;
grant execute on all functions in schema app_private to authenticated;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger households_updated before update on public.households for each row execute function public.set_updated_at();
create trigger categories_updated before update on public.categories for each row execute function public.set_updated_at();
create trigger accounts_updated before update on public.accounts for each row execute function public.set_updated_at();
create trigger cards_updated before update on public.credit_cards for each row execute function public.set_updated_at();
create trigger statements_updated before update on public.card_statements for each row execute function public.set_updated_at();
create trigger transactions_updated before update on public.transactions for each row execute function public.set_updated_at();
create trigger scheduled_updated before update on public.scheduled_expenses for each row execute function public.set_updated_at();
create trigger debts_updated before update on public.debts for each row execute function public.set_updated_at();
create trigger budgets_updated before update on public.budgets for each row execute function public.set_updated_at();

create or replace function app_private.validate_household_links()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare linked_household uuid;
begin
  if new.owner_id is not null and not exists (
    select 1 from public.household_members hm where hm.household_id = new.household_id and hm.user_id = new.owner_id and hm.status = 'active'
  ) then raise exception 'owner_must_be_active_household_member' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger accounts_validate_owner before insert or update on public.accounts for each row execute function app_private.validate_household_links();
create trigger cards_validate_owner before insert or update on public.credit_cards for each row execute function app_private.validate_household_links();

create or replace function app_private.validate_transaction_links()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.created_by <> auth.uid() and auth.uid() is not null then raise exception 'created_by_mismatch' using errcode = '42501'; end if;
  if new.source_account_id is not null and not exists (select 1 from public.accounts where id = new.source_account_id and household_id = new.household_id and archived_at is null) then raise exception 'invalid_source_account' using errcode = '23514'; end if;
  if new.destination_account_id is not null and not exists (select 1 from public.accounts where id = new.destination_account_id and household_id = new.household_id and archived_at is null) then raise exception 'invalid_destination_account' using errcode = '23514'; end if;
  if new.card_id is not null and not exists (select 1 from public.credit_cards where id = new.card_id and household_id = new.household_id and archived_at is null) then raise exception 'invalid_card' using errcode = '23514'; end if;
  if new.category_id is not null and not exists (select 1 from public.categories where id = new.category_id and household_id = new.household_id and archived_at is null) then raise exception 'invalid_category' using errcode = '23514'; end if;
  return new;
end;
$$;
create trigger transactions_validate_links before insert or update on public.transactions for each row execute function app_private.validate_transaction_links();

create or replace function app_private.audit_row()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare household uuid; record_uuid uuid;
begin
  household := coalesce(new.household_id, old.household_id);
  record_uuid := coalesce(new.id, old.id);
  insert into public.audit_logs (household_id, actor_id, action, table_name, record_id, old_data, new_data, request_id)
  values (
    household,
    auth.uid(),
    tg_op,
    tg_table_name,
    record_uuid,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id'
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_accounts after insert or update or delete on public.accounts for each row execute function app_private.audit_row();
create trigger audit_cards after insert or update or delete on public.credit_cards for each row execute function app_private.audit_row();
create trigger audit_transactions after insert or update or delete on public.transactions for each row execute function app_private.audit_row();
create trigger audit_scheduled after insert or update or delete on public.scheduled_expenses for each row execute function app_private.audit_row();
create trigger audit_debts after insert or update or delete on public.debts for each row execute function app_private.audit_row();
create trigger audit_budgets after insert or update or delete on public.budgets for each row execute function app_private.audit_row();

alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.categories enable row level security;
alter table public.accounts enable row level security;
alter table public.credit_cards enable row level security;
alter table public.card_statements enable row level security;
alter table public.transactions enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.statement_payments enable row level security;
alter table public.scheduled_expenses enable row level security;
alter table public.debts enable row level security;
alter table public.debt_payments enable row level security;
alter table public.budgets enable row level security;
alter table public.attachments enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.audit_logs enable row level security;
alter table public.ai_usage enable row level security;

create policy profiles_shared_read on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.household_members mine
    join public.household_members theirs on theirs.household_id = mine.household_id
    where mine.user_id = auth.uid() and mine.status = 'active' and theirs.user_id = profiles.id and theirs.status = 'active'
  )
);
create policy profiles_self_insert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy households_member_read on public.households for select to authenticated using (app_private.is_household_member(id));
create policy households_create on public.households for insert to authenticated with check (created_by = auth.uid());
create policy households_owner_update on public.households for update to authenticated using (app_private.is_household_owner(id)) with check (app_private.is_household_owner(id));

create policy household_members_member_read on public.household_members for select to authenticated using (app_private.is_household_member(household_id));
create policy household_members_owner_insert on public.household_members for insert to authenticated with check (app_private.is_household_owner(household_id));
create policy household_members_owner_update on public.household_members for update to authenticated using (app_private.is_household_owner(household_id)) with check (app_private.is_household_owner(household_id));
create policy household_members_owner_delete on public.household_members for delete to authenticated using (app_private.is_household_owner(household_id) and user_id <> auth.uid());

create policy categories_member_read on public.categories for select to authenticated using (app_private.is_household_member(household_id));
create policy categories_member_insert on public.categories for insert to authenticated with check (app_private.is_household_member(household_id) and created_by = auth.uid());
create policy categories_member_update on public.categories for update to authenticated using (app_private.is_household_member(household_id)) with check (app_private.is_household_member(household_id));

create policy accounts_member_read on public.accounts for select to authenticated using (app_private.is_household_member(household_id));
create policy accounts_member_insert on public.accounts for insert to authenticated with check (app_private.is_household_member(household_id) and created_by = auth.uid());
create policy accounts_member_update on public.accounts for update to authenticated using (app_private.is_household_member(household_id)) with check (app_private.is_household_member(household_id));

create policy cards_member_read on public.credit_cards for select to authenticated using (app_private.is_household_member(household_id));
create policy cards_member_insert on public.credit_cards for insert to authenticated with check (app_private.is_household_member(household_id) and created_by = auth.uid());
create policy cards_member_update on public.credit_cards for update to authenticated using (app_private.is_household_member(household_id)) with check (app_private.is_household_member(household_id));

create policy statements_member_read on public.card_statements for select to authenticated using (app_private.is_household_member(household_id));
create policy transactions_member_read on public.transactions for select to authenticated using (app_private.is_household_member(household_id));
create policy ledger_member_read on public.ledger_entries for select to authenticated using (app_private.is_household_member(household_id));
create policy statement_payments_member_read on public.statement_payments for select to authenticated using (app_private.is_household_member(household_id));

create policy scheduled_member_read on public.scheduled_expenses for select to authenticated using (app_private.is_household_member(household_id));
create policy scheduled_member_insert on public.scheduled_expenses for insert to authenticated with check (app_private.is_household_member(household_id) and created_by = auth.uid());
create policy scheduled_member_update on public.scheduled_expenses for update to authenticated using (app_private.is_household_member(household_id)) with check (app_private.is_household_member(household_id));

create policy debts_member_read on public.debts for select to authenticated using (app_private.is_household_member(household_id));
create policy debts_member_insert on public.debts for insert to authenticated with check (app_private.is_household_member(household_id) and created_by = auth.uid());
create policy debts_member_update on public.debts for update to authenticated using (app_private.is_household_member(household_id)) with check (app_private.is_household_member(household_id));
create policy debt_payments_member_read on public.debt_payments for select to authenticated using (app_private.is_household_member(household_id));

create policy budgets_member_read on public.budgets for select to authenticated using (app_private.is_household_member(household_id));
create policy budgets_member_insert on public.budgets for insert to authenticated with check (app_private.is_household_member(household_id) and created_by = auth.uid());
create policy budgets_member_update on public.budgets for update to authenticated using (app_private.is_household_member(household_id)) with check (app_private.is_household_member(household_id));

create policy attachments_member_read on public.attachments for select to authenticated using (app_private.is_household_member(household_id));
create policy attachments_member_insert on public.attachments for insert to authenticated with check (app_private.is_household_member(household_id) and created_by = auth.uid() and storage_path like household_id::text || '/%');
create policy attachments_member_delete on public.attachments for delete to authenticated using (app_private.is_household_member(household_id));

create policy notifications_own_read on public.notifications for select to authenticated using (user_id = auth.uid() and app_private.is_household_member(household_id));
create policy notifications_own_update on public.notifications for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy preferences_own_all on public.notification_preferences for all to authenticated using (user_id = auth.uid() and app_private.is_household_member(household_id)) with check (user_id = auth.uid() and app_private.is_household_member(household_id));

create policy audit_member_read on public.audit_logs for select to authenticated using (app_private.is_household_member(household_id));
create policy ai_usage_own_read on public.ai_usage for select to authenticated using (user_id = auth.uid() and app_private.is_household_member(household_id));

revoke insert, update, delete on public.transactions, public.ledger_entries, public.card_statements, public.statement_payments, public.debt_payments, public.audit_logs, public.ai_usage from authenticated;

create or replace view public.account_balances
with (security_invoker = true)
as
select
  a.id,
  a.household_id,
  a.owner_id,
  a.name,
  a.institution,
  a.kind,
  a.currency,
  a.opening_balance_cents + coalesce(sum(le.amount_cents) filter (where t.status = 'posted' and t.deleted_at is null), 0)::bigint as balance_cents
from public.accounts a
left join public.ledger_entries le on le.account_id = a.id
left join public.transactions t on t.id = le.transaction_id
where a.archived_at is null
group by a.id;

create or replace view public.statement_totals
with (security_invoker = true)
as
select
  s.id,
  s.household_id,
  s.card_id,
  s.period_start,
  s.period_end,
  s.closing_date,
  s.due_date,
  coalesce(sum(t.amount_cents) filter (where t.kind = 'card_purchase' and t.status = 'posted' and t.deleted_at is null), 0)::bigint as purchase_total_cents,
  s.amount_paid_cents,
  greatest(coalesce(sum(t.amount_cents) filter (where t.kind = 'card_purchase' and t.status = 'posted' and t.deleted_at is null), 0) - s.amount_paid_cents, 0)::bigint as remaining_cents,
  s.status
from public.card_statements s
left join public.transactions t on t.statement_id = s.id
group by s.id;

grant select on public.account_balances, public.statement_totals to authenticated;

alter publication supabase_realtime add table public.transactions;
alter publication supabase_realtime add table public.card_statements;
alter publication supabase_realtime add table public.scheduled_expenses;
alter publication supabase_realtime add table public.budgets;
alter publication supabase_realtime add table public.notifications;
