-- Entradas futuras compartilhadas e separação entre saldo comum e Ticket.

create table if not exists public.future_incomes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  title text not null check (char_length(trim(title)) between 2 and 100),
  amount_cents bigint not null check (amount_cents > 0),
  expected_date date not null,
  destination_type text not null check (destination_type in ('account', 'ticket')),
  destination_account_id uuid references public.accounts(id) on delete set null,
  recurrence_rule text check (recurrence_rule is null or recurrence_rule = 'FREQ=MONTHLY'),
  client_request_key uuid not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (household_id, client_request_key)
);

create index if not exists future_incomes_household_date_idx
  on public.future_incomes(household_id, expected_date) where archived_at is null;

drop trigger if exists future_incomes_updated on public.future_incomes;
create trigger future_incomes_updated before update on public.future_incomes
  for each row execute function public.set_updated_at();

drop trigger if exists audit_future_incomes on public.future_incomes;
create trigger audit_future_incomes after insert or update or delete on public.future_incomes
  for each row execute function app_private.audit_row();

alter table public.future_incomes enable row level security;
drop policy if exists future_incomes_member_read on public.future_incomes;
create policy future_incomes_member_read on public.future_incomes
  for select to authenticated using (app_private.is_household_member(household_id));

grant select on public.future_incomes to authenticated;
revoke insert, update, delete on public.future_incomes from authenticated;

create or replace function public.save_future_income(
  target_household uuid,
  target_income uuid,
  target_owner uuid,
  income_title text,
  income_amount bigint,
  income_date date,
  income_destination text,
  destination_account uuid,
  recurring boolean,
  request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare saved_id uuid; account_record record;
begin
  perform app_private.assert_household_member(target_household);
  if not exists (
    select 1 from public.household_members
    where household_id = target_household and user_id = target_owner and status = 'active'
  ) then raise exception 'invalid_future_income_owner' using errcode = '22023'; end if;
  if request_key is null or char_length(trim(income_title)) not between 2 and 100
    or income_amount <= 0 or income_date < (now() at time zone 'America/Sao_Paulo')::date
    or income_destination not in ('account', 'ticket')
  then raise exception 'invalid_future_income' using errcode = '22023'; end if;

  if destination_account is not null then
    select * into account_record from public.accounts
    where id = destination_account and household_id = target_household and archived_at is null and is_active;
    if not found then raise exception 'invalid_future_income_account' using errcode = '22023'; end if;
    if income_destination = 'ticket' and account_record.ticket_reload_day is null then
      raise exception 'invalid_future_income_ticket_account' using errcode = '22023';
    end if;
    if income_destination = 'account' and account_record.ticket_reload_day is not null then
      raise exception 'invalid_future_income_cash_account' using errcode = '22023';
    end if;
  end if;

  if target_income is null then
    select id into saved_id from public.future_incomes
    where household_id = target_household and client_request_key = request_key;
    if saved_id is not null then return saved_id; end if;
    insert into public.future_incomes(
      household_id, owner_id, title, amount_cents, expected_date, destination_type,
      destination_account_id, recurrence_rule, client_request_key, created_by
    ) values (
      target_household, target_owner, trim(income_title), income_amount, income_date, income_destination,
      destination_account, case when recurring then 'FREQ=MONTHLY' end, request_key, auth.uid()
    ) returning id into saved_id;
  else
    update public.future_incomes set
      owner_id = target_owner,
      title = trim(income_title),
      amount_cents = income_amount,
      expected_date = income_date,
      destination_type = income_destination,
      destination_account_id = destination_account,
      recurrence_rule = case when recurring then 'FREQ=MONTHLY' end
    where id = target_income and household_id = target_household and archived_at is null
    returning id into saved_id;
    if saved_id is null then raise exception 'future_income_not_found' using errcode = '22023'; end if;
  end if;
  return saved_id;
end;
$$;

create or replace function public.archive_future_income(target_household uuid, target_income uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare archived_id uuid;
begin
  perform app_private.assert_household_member(target_household);
  update public.future_incomes set archived_at = now()
  where id = target_income and household_id = target_household and archived_at is null
  returning id into archived_id;
  if archived_id is null then raise exception 'future_income_not_found' using errcode = '22023'; end if;
  return archived_id;
end;
$$;

revoke all on function public.save_future_income(uuid, uuid, uuid, text, bigint, date, text, uuid, boolean, uuid) from public;
grant execute on function public.save_future_income(uuid, uuid, uuid, text, bigint, date, text, uuid, boolean, uuid) to authenticated;
revoke all on function public.archive_future_income(uuid, uuid) from public;
grant execute on function public.archive_future_income(uuid, uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'future_incomes'
  ) then alter publication supabase_realtime add table public.future_incomes; end if;
end;
$$;
