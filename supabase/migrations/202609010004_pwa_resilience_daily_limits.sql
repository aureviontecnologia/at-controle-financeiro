-- Escritas idempotentes para PWA e limite diario compartilhado da familia.

alter table public.accounts add column if not exists client_request_key uuid;
alter table public.credit_cards add column if not exists client_request_key uuid;

create unique index if not exists accounts_household_request_key_unique
  on public.accounts(household_id, client_request_key) where client_request_key is not null;
create unique index if not exists cards_household_request_key_unique
  on public.credit_cards(household_id, client_request_key) where client_request_key is not null;

create table if not exists public.household_finance_settings (
  household_id uuid primary key references public.households(id) on delete cascade,
  daily_spend_limit_cents bigint not null default 0 check (daily_spend_limit_cents >= 0),
  updated_by uuid not null references public.profiles(id),
  updated_at timestamptz not null default now()
);

alter table public.household_finance_settings enable row level security;
drop policy if exists household_finance_settings_member_read on public.household_finance_settings;
drop policy if exists household_finance_settings_member_insert on public.household_finance_settings;
drop policy if exists household_finance_settings_member_update on public.household_finance_settings;
create policy household_finance_settings_member_read on public.household_finance_settings
  for select to authenticated using (app_private.is_household_member(household_id));
create policy household_finance_settings_member_insert on public.household_finance_settings
  for insert to authenticated with check (app_private.is_household_member(household_id) and updated_by = auth.uid());
create policy household_finance_settings_member_update on public.household_finance_settings
  for update to authenticated using (app_private.is_household_member(household_id))
  with check (app_private.is_household_member(household_id) and updated_by = auth.uid());
grant select, insert, update on public.household_finance_settings to authenticated;

create or replace function public.create_financial_account(
  target_household uuid,
  account_name text,
  account_institution text,
  account_kind public.account_kind,
  opening_amount bigint,
  is_ticket boolean,
  reload_day smallint,
  reload_cents bigint,
  request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare created_account_id uuid;
begin
  perform app_private.assert_household_member(target_household);
  if request_key is null or char_length(trim(account_name)) not between 2 and 80
    or char_length(trim(account_institution)) not between 2 and 80 or opening_amount < 0
    or (is_ticket and (reload_day not between 1 and 31 or reload_cents <= 0))
    or (not is_ticket and (reload_day is not null or reload_cents is not null))
  then raise exception 'invalid_account_data' using errcode = '22023'; end if;

  select id into created_account_id from public.accounts
  where household_id = target_household and client_request_key = request_key;
  if created_account_id is not null then return created_account_id; end if;

  begin
    insert into public.accounts(
      household_id, owner_id, name, institution, kind, opening_balance_cents,
      ticket_reload_day, ticket_reload_cents, client_request_key, created_by
    ) values (
      target_household, auth.uid(), trim(account_name), trim(account_institution), account_kind, opening_amount,
      case when is_ticket then reload_day end, case when is_ticket then reload_cents end, request_key, auth.uid()
    ) returning id into created_account_id;
  exception when unique_violation then
    select id into created_account_id from public.accounts
    where household_id = target_household and client_request_key = request_key;
    if created_account_id is null then raise; end if;
  end;
  return created_account_id;
end;
$$;

revoke all on function public.create_financial_account(uuid, text, text, public.account_kind, bigint, boolean, smallint, bigint, uuid) from public;
grant execute on function public.create_financial_account(uuid, text, text, public.account_kind, bigint, boolean, smallint, bigint, uuid) to authenticated;

create or replace function public.create_credit_card_idempotent(
  target_household uuid,
  card_name text,
  card_institution text,
  card_last_four text,
  card_limit bigint,
  card_closing_day smallint,
  card_due_day smallint,
  current_invoice bigint,
  future_invoices jsonb,
  card_additional_limit bigint,
  reported_used bigint,
  request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare created_card_id uuid;
begin
  perform app_private.assert_household_member(target_household);
  if request_key is null then raise exception 'invalid_request_key' using errcode = '22023'; end if;
  select id into created_card_id from public.credit_cards
  where household_id = target_household and client_request_key = request_key;
  if created_card_id is not null then return created_card_id; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_household::text || request_key::text, 0));
  select id into created_card_id from public.credit_cards
  where household_id = target_household and client_request_key = request_key;
  if created_card_id is not null then return created_card_id; end if;

  created_card_id := public.create_credit_card_with_current_invoice(
    target_household, card_name, card_institution, card_last_four, card_limit,
    card_closing_day, card_due_day, current_invoice, future_invoices,
    card_additional_limit, reported_used
  );
  update public.credit_cards set client_request_key = request_key where id = created_card_id;
  return created_card_id;
end;
$$;

revoke all on function public.create_credit_card_idempotent(uuid, text, text, text, bigint, smallint, smallint, bigint, jsonb, bigint, bigint, uuid) from public;
grant execute on function public.create_credit_card_idempotent(uuid, text, text, text, bigint, smallint, smallint, bigint, jsonb, bigint, bigint, uuid) to authenticated;

create or replace function public.set_daily_spend_limit(target_household uuid, limit_amount bigint)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app_private.assert_household_member(target_household);
  if limit_amount < 0 then raise exception 'invalid_daily_limit' using errcode = '22023'; end if;
  insert into public.household_finance_settings(household_id, daily_spend_limit_cents, updated_by)
  values (target_household, limit_amount, auth.uid())
  on conflict (household_id) do update set
    daily_spend_limit_cents = excluded.daily_spend_limit_cents,
    updated_by = auth.uid(), updated_at = now();
  return limit_amount;
end;
$$;

revoke all on function public.set_daily_spend_limit(uuid, bigint) from public;
grant execute on function public.set_daily_spend_limit(uuid, bigint) to authenticated;
