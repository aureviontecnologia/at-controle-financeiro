-- Recarga mensal de Ticket confirmada e pagamento parcial de fatura com bloqueio transacional.

alter table public.accounts
  add column if not exists ticket_last_confirmed_month date;

alter table public.accounts drop constraint if exists accounts_ticket_last_confirmed_month_check;
alter table public.accounts add constraint accounts_ticket_last_confirmed_month_check
  check (ticket_last_confirmed_month is null or ticket_last_confirmed_month = date_trunc('month', ticket_last_confirmed_month)::date);

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
  a.opening_balance_cents + coalesce(sum(le.amount_cents) filter (where t.status = 'posted' and t.deleted_at is null), 0)::bigint as balance_cents,
  a.ticket_reload_day,
  a.ticket_reload_cents,
  a.ticket_last_confirmed_month
from public.accounts a
left join public.ledger_entries le on le.account_id = a.id
left join public.transactions t on t.id = le.transaction_id
where a.archived_at is null and a.is_active
group by a.id;

grant select on public.account_balances to authenticated;

create or replace function public.confirm_ticket_reload(
  target_household uuid,
  target_account uuid,
  amount bigint,
  received_at timestamptz,
  request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  account_record record;
  transaction_uuid uuid;
  existing_uuid uuid;
  confirmation_month date := date_trunc('month', received_at at time zone 'America/Sao_Paulo')::date;
begin
  perform app_private.assert_household_member(target_household);
  if amount <= 0 then raise exception 'amount_must_be_positive' using errcode = '22023'; end if;
  existing_uuid := app_private.idempotent_transaction_id(target_household, request_key);
  if existing_uuid is not null then return existing_uuid; end if;

  select * into account_record
  from public.accounts
  where id = target_account and household_id = target_household and archived_at is null and is_active
  for update;
  if not found then raise exception 'account_not_found' using errcode = '22023'; end if;
  if account_record.ticket_reload_day is null or account_record.ticket_reload_cents is null then
    raise exception 'account_not_ticket' using errcode = '22023';
  end if;
  if account_record.ticket_last_confirmed_month = confirmation_month then
    raise exception 'ticket_reload_already_confirmed' using errcode = '22023';
  end if;

  insert into public.transactions(
    household_id, kind, amount_cents, description, payment_method,
    destination_account_id, created_by, occurred_at, idempotency_key
  ) values (
    target_household, 'income', amount, 'Recarga ' || account_record.name, 'other',
    target_account, auth.uid(), received_at, request_key
  ) returning id into transaction_uuid;

  insert into public.ledger_entries(household_id, transaction_id, account_id, amount_cents)
  values (target_household, transaction_uuid, target_account, amount);

  update public.accounts
  set ticket_last_confirmed_month = confirmation_month, updated_at = now()
  where id = target_account;

  return transaction_uuid;
end;
$$;

revoke all on function public.confirm_ticket_reload(uuid, uuid, bigint, timestamptz, uuid) from public;
grant execute on function public.confirm_ticket_reload(uuid, uuid, bigint, timestamptz, uuid) to authenticated;

create or replace function public.pay_card_statement(
  target_household uuid,
  target_statement uuid,
  target_account uuid,
  amount bigint,
  paid_at timestamptz,
  request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  transaction_uuid uuid;
  existing_uuid uuid;
  statement_record record;
  account_record record;
  source_balance bigint;
  reserved_balance bigint;
begin
  perform app_private.assert_household_member(target_household);
  if amount <= 0 then raise exception 'amount_must_be_positive' using errcode = '22023'; end if;
  existing_uuid := app_private.idempotent_transaction_id(target_household, request_key);
  if existing_uuid is not null then return existing_uuid; end if;

  select * into account_record
  from public.accounts
  where id = target_account and household_id = target_household and archived_at is null and is_active
  for update;
  if not found then raise exception 'account_not_found' using errcode = '22023'; end if;
  if account_record.ticket_reload_day is not null then raise exception 'invalid_payment_account' using errcode = '22023'; end if;

  perform 1 from public.card_statements
  where id = target_statement and household_id = target_household
  for update;
  if not found then raise exception 'statement_not_found' using errcode = '22023'; end if;

  select st.*, c.name as card_name into statement_record
  from public.statement_totals st
  join public.credit_cards c on c.id = st.card_id
  where st.id = target_statement and st.household_id = target_household;
  if not found then raise exception 'statement_not_found' using errcode = '22023'; end if;
  if amount > statement_record.remaining_cents then raise exception 'payment_exceeds_statement_balance' using errcode = '22023'; end if;

  select balance_cents into source_balance from public.account_balances where id = target_account;
  select coalesce(sum(balance_cents), 0)::bigint into reserved_balance
  from public.savings_pots where account_id = target_account and archived_at is null;
  if coalesce(source_balance, 0) - reserved_balance < amount then raise exception 'insufficient_funds' using errcode = 'P0001'; end if;

  insert into public.transactions(
    household_id, kind, amount_cents, description, payment_method,
    source_account_id, card_id, statement_id, created_by, occurred_at, idempotency_key
  ) values (
    target_household, 'card_payment', amount, 'Pagamento da fatura ' || statement_record.card_name, 'transfer',
    target_account, statement_record.card_id, target_statement, auth.uid(), paid_at, request_key
  ) returning id into transaction_uuid;

  insert into public.ledger_entries(household_id, transaction_id, account_id, amount_cents)
  values (target_household, transaction_uuid, target_account, -amount);

  insert into public.statement_payments(household_id, statement_id, transaction_id, account_id, amount_cents, paid_at, created_by)
  values (target_household, target_statement, transaction_uuid, target_account, amount, paid_at, auth.uid());

  update public.card_statements
  set amount_paid_cents = amount_paid_cents + amount,
      status = case when amount >= statement_record.remaining_cents then 'paid' else 'partially_paid' end,
      updated_at = now()
  where id = target_statement;

  return transaction_uuid;
end;
$$;

revoke all on function public.pay_card_statement(uuid, uuid, uuid, bigint, timestamptz, uuid) from public;
grant execute on function public.pay_card_statement(uuid, uuid, uuid, bigint, timestamptz, uuid) to authenticated;
