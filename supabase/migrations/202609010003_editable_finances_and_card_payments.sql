-- Cartoes editaveis, reconciliacao do limite, pagamento de fatura e previsao de ticket.

alter table public.credit_cards
  add column if not exists unallocated_usage_cents bigint not null default 0
  check (unallocated_usage_cents >= 0);

alter table public.accounts
  add column if not exists ticket_reload_day smallint
  check (ticket_reload_day is null or ticket_reload_day between 1 and 31);

alter table public.accounts
  add column if not exists ticket_reload_cents bigint
  check (ticket_reload_cents is null or ticket_reload_cents > 0);

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
  a.ticket_reload_cents
from public.accounts a
left join public.ledger_entries le on le.account_id = a.id
left join public.transactions t on t.id = le.transaction_id
where a.archived_at is null and a.is_active
group by a.id;

grant select on public.account_balances to authenticated;

drop function if exists public.create_credit_card_with_current_invoice(uuid, text, text, text, bigint, smallint, smallint, bigint, jsonb);

create or replace function public.create_credit_card_with_current_invoice(
  target_household uuid,
  card_name text,
  card_institution text,
  card_last_four text,
  card_limit bigint,
  card_closing_day smallint,
  card_due_day smallint,
  current_invoice bigint default 0,
  future_invoices jsonb default '[]'::jsonb,
  card_additional_limit bigint default 0,
  reported_used bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  created_card_id uuid;
  invoice jsonb;
  invoice_month date;
  invoice_amount bigint;
  invoice_due date;
  invoice_close date;
  as_of_date date := (now() at time zone 'America/Sao_Paulo')::date;
  current_due_month date;
  current_close_month date;
  previous_close_month date;
  previous_close date;
  future_total bigint;
  used_total bigint;
begin
  perform app_private.assert_household_member(target_household);
  if jsonb_typeof(future_invoices) <> 'array' then raise exception 'invalid_future_invoices' using errcode = '22023'; end if;
  select coalesce(sum((value ->> 'amountCents')::bigint), 0) into future_total from jsonb_array_elements(future_invoices);
  used_total := greatest(current_invoice + future_total, coalesce(reported_used, 0));
  if char_length(trim(card_name)) not between 2 and 80
    or char_length(trim(card_institution)) not between 2 and 80
    or card_limit <= 0 or card_additional_limit < 0 or current_invoice < 0 or future_total < 0
    or used_total > card_limit + card_additional_limit
    or card_closing_day not between 1 and 31 or card_due_day not between 1 and 31
    or (nullif(trim(card_last_four), '') is not null and trim(card_last_four) !~ '^[0-9]{4}$')
  then raise exception 'invalid_card_data' using errcode = '22023'; end if;

  insert into public.credit_cards(
    household_id, owner_id, name, institution, last_four, limit_cents,
    additional_limit_cents, unallocated_usage_cents, closing_day, due_day, created_by
  ) values (
    target_household, auth.uid(), trim(card_name), trim(card_institution), nullif(trim(card_last_four), ''), card_limit,
    card_additional_limit, greatest(used_total - current_invoice - future_total, 0), card_closing_day, card_due_day, auth.uid()
  ) returning id into created_card_id;

  if current_invoice > 0 then
    current_due_month := date_trunc('month', as_of_date)::date;
    invoice_due := current_due_month + (least(card_due_day, extract(day from (current_due_month + interval '1 month - 1 day'))::int) - 1);
    if as_of_date > invoice_due then
      current_due_month := (current_due_month + interval '1 month')::date;
      invoice_due := current_due_month + (least(card_due_day, extract(day from (current_due_month + interval '1 month - 1 day'))::int) - 1);
    end if;
    current_close_month := case when card_due_day <= card_closing_day then (current_due_month - interval '1 month')::date else current_due_month end;
    invoice_close := date_trunc('month', current_close_month)::date + (least(card_closing_day, extract(day from (date_trunc('month', current_close_month) + interval '1 month - 1 day'))::int) - 1);
    previous_close_month := (date_trunc('month', invoice_close) - interval '1 month')::date;
    previous_close := previous_close_month + (least(card_closing_day, extract(day from (previous_close_month + interval '1 month - 1 day'))::int) - 1);
    insert into public.card_statements(household_id, card_id, period_start, period_end, closing_date, due_date, opening_balance_cents)
    values (target_household, created_card_id, previous_close + 1, invoice_close, invoice_close, invoice_due, current_invoice);
  end if;

  for invoice in select value from jsonb_array_elements(future_invoices) loop
    invoice_month := (invoice ->> 'month')::date;
    invoice_amount := (invoice ->> 'amountCents')::bigint;
    if invoice_month <> date_trunc('month', invoice_month)::date
      or invoice_month <= date_trunc('month', as_of_date)::date or invoice_amount <= 0
    then raise exception 'invalid_future_invoice' using errcode = '22023'; end if;
    invoice_due := invoice_month + (least(card_due_day, extract(day from (invoice_month + interval '1 month - 1 day'))::int) - 1);
    invoice_close := case when card_due_day <= card_closing_day then (invoice_month - interval '1 month')::date else invoice_month end;
    invoice_close := date_trunc('month', invoice_close)::date + (least(card_closing_day, extract(day from (date_trunc('month', invoice_close) + interval '1 month - 1 day'))::int) - 1);
    previous_close_month := (date_trunc('month', invoice_close) - interval '1 month')::date;
    previous_close := previous_close_month + (least(card_closing_day, extract(day from (previous_close_month + interval '1 month - 1 day'))::int) - 1);
    insert into public.card_statements(household_id, card_id, period_start, period_end, closing_date, due_date, opening_balance_cents)
    values (target_household, created_card_id, previous_close + 1, invoice_close, invoice_close, invoice_due, invoice_amount)
    on conflict on constraint card_statements_card_id_closing_date_key do update
      set opening_balance_cents = public.card_statements.opening_balance_cents + excluded.opening_balance_cents, updated_at = now();
  end loop;
  return created_card_id;
end;
$$;

revoke all on function public.create_credit_card_with_current_invoice(uuid, text, text, text, bigint, smallint, smallint, bigint, jsonb, bigint, bigint) from public;
grant execute on function public.create_credit_card_with_current_invoice(uuid, text, text, text, bigint, smallint, smallint, bigint, jsonb, bigint, bigint) to authenticated;

create or replace function public.update_credit_card_financials(
  target_household uuid,
  target_card uuid,
  card_name text,
  card_institution text,
  card_last_four text,
  card_limit bigint,
  card_additional_limit bigint,
  reported_used bigint,
  card_closing_day smallint,
  card_due_day smallint,
  current_invoice bigint,
  future_invoices jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  invoice jsonb;
  invoice_id uuid;
  invoice_month date;
  invoice_amount bigint;
  invoice_due date;
  invoice_close date;
  previous_close_month date;
  previous_close date;
  current_statement record;
  current_statement_id uuid;
  as_of_date date := (now() at time zone 'America/Sao_Paulo')::date;
  current_due_month date;
  current_close_month date;
  future_total bigint;
  used_total bigint;
  other_purchase bigint;
  new_opening bigint;
  kept_ids uuid[] := '{}';
  stale record;
begin
  perform app_private.assert_household_member(target_household);
  perform app_private.assert_card(target_household, target_card);
  perform pg_advisory_xact_lock(hashtextextended(target_card::text, 0));
  if jsonb_typeof(future_invoices) <> 'array' then raise exception 'invalid_future_invoices' using errcode = '22023'; end if;
  select coalesce(sum((value ->> 'amountCents')::bigint), 0) into future_total from jsonb_array_elements(future_invoices);
  used_total := greatest(current_invoice + future_total, coalesce(reported_used, 0));
  if char_length(trim(card_name)) not between 2 and 80 or char_length(trim(card_institution)) not between 2 and 80
    or card_limit <= 0 or card_additional_limit < 0 or current_invoice < 0 or future_total < 0
    or used_total > card_limit + card_additional_limit
    or card_closing_day not between 1 and 31 or card_due_day not between 1 and 31
    or (nullif(trim(card_last_four), '') is not null and trim(card_last_four) !~ '^[0-9]{4}$')
  then raise exception 'invalid_card_data' using errcode = '22023'; end if;

  update public.credit_cards set
    name = trim(card_name), institution = trim(card_institution), last_four = nullif(trim(card_last_four), ''),
    limit_cents = card_limit, additional_limit_cents = card_additional_limit,
    unallocated_usage_cents = greatest(used_total - current_invoice - future_total, 0),
    closing_day = card_closing_day, due_day = card_due_day, updated_at = now()
  where id = target_card and household_id = target_household;

  select st.*, s.opening_balance_cents into current_statement
  from public.statement_totals st join public.card_statements s on s.id = st.id
  where st.card_id = target_card and st.remaining_cents > 0
  order by st.due_date, st.id limit 1;
  current_statement_id := case when found then current_statement.id else null end;

  if current_invoice > 0 and current_statement_id is not null then
    other_purchase := current_statement.purchase_total_cents - current_statement.opening_balance_cents;
    new_opening := current_invoice + current_statement.amount_paid_cents - other_purchase;
    if new_opening < 0 then raise exception 'statement_has_activity' using errcode = '22023'; end if;
    update public.card_statements set opening_balance_cents = new_opening, updated_at = now() where id = current_statement.id;
    kept_ids := array_append(kept_ids, current_statement.id);
  elsif current_invoice > 0 then
    current_due_month := date_trunc('month', as_of_date)::date;
    invoice_due := current_due_month + (least(card_due_day, extract(day from (current_due_month + interval '1 month - 1 day'))::int) - 1);
    if as_of_date > invoice_due then
      current_due_month := (current_due_month + interval '1 month')::date;
      invoice_due := current_due_month + (least(card_due_day, extract(day from (current_due_month + interval '1 month - 1 day'))::int) - 1);
    end if;
    current_close_month := case when card_due_day <= card_closing_day then (current_due_month - interval '1 month')::date else current_due_month end;
    invoice_close := date_trunc('month', current_close_month)::date + (least(card_closing_day, extract(day from (date_trunc('month', current_close_month) + interval '1 month - 1 day'))::int) - 1);
    previous_close_month := (date_trunc('month', invoice_close) - interval '1 month')::date;
    previous_close := previous_close_month + (least(card_closing_day, extract(day from (previous_close_month + interval '1 month - 1 day'))::int) - 1);
    insert into public.card_statements(household_id, card_id, period_start, period_end, closing_date, due_date, opening_balance_cents)
    values (target_household, target_card, previous_close + 1, invoice_close, invoice_close, invoice_due, current_invoice)
    on conflict on constraint card_statements_card_id_closing_date_key do update set opening_balance_cents = excluded.opening_balance_cents, updated_at = now()
    returning id into current_statement_id;
    kept_ids := array_append(kept_ids, current_statement_id);
  elsif current_invoice = 0 and current_statement_id is not null then
    other_purchase := current_statement.purchase_total_cents - current_statement.opening_balance_cents;
    if other_purchase > 0 or current_statement.amount_paid_cents > 0 then raise exception 'statement_has_activity' using errcode = '22023'; end if;
    delete from public.card_statements where id = current_statement.id;
  end if;

  for invoice in select value from jsonb_array_elements(future_invoices) loop
    invoice_month := (invoice ->> 'month')::date;
    invoice_amount := (invoice ->> 'amountCents')::bigint;
    if invoice_month <> date_trunc('month', invoice_month)::date
      or invoice_month <= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date or invoice_amount <= 0
    then raise exception 'invalid_future_invoice' using errcode = '22023'; end if;
    invoice_id := case when coalesce(invoice ->> 'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then (invoice ->> 'id')::uuid else null end;
    if invoice_id is not null and exists (select 1 from public.card_statements where id = invoice_id and card_id = target_card) then
      select st.purchase_total_cents - s.opening_balance_cents, st.amount_paid_cents
      into other_purchase, new_opening from public.statement_totals st join public.card_statements s on s.id = st.id where st.id = invoice_id;
      new_opening := invoice_amount + new_opening - other_purchase;
      if new_opening < 0 then raise exception 'statement_has_activity' using errcode = '22023'; end if;
      update public.card_statements set opening_balance_cents = new_opening, due_date = invoice_month + (least(card_due_day, extract(day from (invoice_month + interval '1 month - 1 day'))::int) - 1), updated_at = now() where id = invoice_id;
      kept_ids := array_append(kept_ids, invoice_id);
    else
      invoice_due := invoice_month + (least(card_due_day, extract(day from (invoice_month + interval '1 month - 1 day'))::int) - 1);
      invoice_close := case when card_due_day <= card_closing_day then (invoice_month - interval '1 month')::date else invoice_month end;
      invoice_close := date_trunc('month', invoice_close)::date + (least(card_closing_day, extract(day from (date_trunc('month', invoice_close) + interval '1 month - 1 day'))::int) - 1);
      previous_close_month := (date_trunc('month', invoice_close) - interval '1 month')::date;
      previous_close := previous_close_month + (least(card_closing_day, extract(day from (previous_close_month + interval '1 month - 1 day'))::int) - 1);
      insert into public.card_statements(household_id, card_id, period_start, period_end, closing_date, due_date, opening_balance_cents)
      values (target_household, target_card, previous_close + 1, invoice_close, invoice_close, invoice_due, invoice_amount)
      on conflict on constraint card_statements_card_id_closing_date_key do update set opening_balance_cents = public.card_statements.opening_balance_cents + excluded.opening_balance_cents, updated_at = now()
      returning id into invoice_id;
      kept_ids := array_append(kept_ids, invoice_id);
    end if;
  end loop;

  for stale in select st.*, s.opening_balance_cents from public.statement_totals st join public.card_statements s on s.id = st.id where st.card_id = target_card and st.remaining_cents > 0 and not (st.id = any(kept_ids)) loop
    if stale.purchase_total_cents - stale.opening_balance_cents > 0 or stale.amount_paid_cents > 0 then raise exception 'statement_has_activity' using errcode = '22023'; end if;
    delete from public.card_statements where id = stale.id;
  end loop;
  return target_card;
end;
$$;

revoke all on function public.update_credit_card_financials(uuid, uuid, text, text, text, bigint, bigint, bigint, smallint, smallint, bigint, jsonb) from public;
grant execute on function public.update_credit_card_financials(uuid, uuid, text, text, text, bigint, bigint, bigint, smallint, smallint, bigint, jsonb) to authenticated;

create or replace function public.update_account_financials(
  target_household uuid,
  target_account uuid,
  account_name text,
  account_institution text,
  account_kind public.account_kind,
  target_balance bigint,
  reload_day smallint,
  reload_cents bigint,
  request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare current_balance bigint; reserved_balance bigint; delta bigint; transaction_uuid uuid;
begin
  perform app_private.assert_household_member(target_household);
  perform app_private.assert_account(target_household, target_account);
  if char_length(trim(account_name)) not between 2 and 80 or char_length(trim(account_institution)) not between 2 and 80
    or target_balance < 0 or (reload_day is null) <> (reload_cents is null)
    or (reload_day is not null and reload_day not between 1 and 31) or (reload_cents is not null and reload_cents <= 0)
  then raise exception 'invalid_account_data' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_account::text, 0));
  select balance_cents into current_balance from public.account_balances where id = target_account and household_id = target_household;
  select coalesce(sum(balance_cents), 0) into reserved_balance from public.savings_pots where account_id = target_account and archived_at is null;
  if target_balance < reserved_balance then raise exception 'balance_below_reserved' using errcode = '22023'; end if;
  update public.accounts set name = trim(account_name), institution = trim(account_institution), kind = account_kind,
    ticket_reload_day = reload_day, ticket_reload_cents = reload_cents, updated_at = now()
  where id = target_account and household_id = target_household;
  delta := target_balance - current_balance;
  if delta = 0 then return target_account; end if;
  select id into transaction_uuid from public.transactions where household_id = target_household and idempotency_key = request_key;
  if transaction_uuid is not null then return target_account; end if;
  insert into public.transactions(household_id, kind, amount_cents, description, payment_method, source_account_id, destination_account_id, created_by, occurred_at, idempotency_key)
  values (target_household, 'adjustment', abs(delta), 'Ajuste de saldo em ' || trim(account_name), 'other', case when delta < 0 then target_account end, case when delta > 0 then target_account end, auth.uid(), now(), request_key)
  returning id into transaction_uuid;
  insert into public.ledger_entries(household_id, transaction_id, account_id, amount_cents)
  values (target_household, transaction_uuid, target_account, delta);
  return target_account;
end;
$$;

revoke all on function public.update_account_financials(uuid, uuid, text, text, public.account_kind, bigint, smallint, bigint, uuid) from public;
grant execute on function public.update_account_financials(uuid, uuid, text, text, public.account_kind, bigint, smallint, bigint, uuid) to authenticated;

create or replace function public.post_card_purchase(
  target_household uuid, target_card uuid, amount bigint, item_description text,
  purchased_at timestamptz, request_key uuid, target_category uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare transaction_uuid uuid; existing_uuid uuid; statement_uuid uuid; dates record; card_record record; used bigint;
begin
  perform app_private.assert_household_member(target_household); perform app_private.assert_card(target_household, target_card);
  if amount <= 0 then raise exception 'amount_must_be_positive' using errcode = '22023'; end if;
  existing_uuid := app_private.idempotent_transaction_id(target_household, request_key); if existing_uuid is not null then return existing_uuid; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_card::text, 0));
  select * into card_record from public.credit_cards where id = target_card;
  select coalesce(sum(st.remaining_cents), 0) + card_record.unallocated_usage_cents into used from public.statement_totals st where st.card_id = target_card;
  if used + amount > card_record.limit_cents + card_record.additional_limit_cents then raise exception 'card_limit_exceeded' using errcode = 'P0001'; end if;
  select * into dates from app_private.statement_dates(purchased_at::date, card_record.closing_day, card_record.due_day);
  insert into public.card_statements(household_id, card_id, period_start, period_end, closing_date, due_date)
  values (target_household, target_card, dates.period_start, dates.period_end, dates.closing_date, dates.due_date)
  on conflict (card_id, closing_date) do update set updated_at = now() returning id into statement_uuid;
  insert into public.transactions(household_id, kind, amount_cents, description, category_id, payment_method, card_id, statement_id, created_by, occurred_at, idempotency_key)
  values (target_household, 'card_purchase', amount, trim(item_description), target_category, 'credit_card', target_card, statement_uuid, auth.uid(), purchased_at, request_key)
  on conflict (household_id, idempotency_key) do nothing returning id into transaction_uuid;
  if transaction_uuid is null then return app_private.idempotent_transaction_id(target_household, request_key); end if;
  return transaction_uuid;
end;
$$;

create or replace function public.pay_card_statement(
  target_household uuid, target_statement uuid, target_account uuid, amount bigint, paid_at timestamptz, request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare transaction_uuid uuid; existing_uuid uuid; statement_record record; source_balance bigint; new_paid bigint;
begin
  perform app_private.assert_household_member(target_household); perform app_private.assert_account(target_household, target_account);
  if amount <= 0 then raise exception 'amount_must_be_positive' using errcode = '22023'; end if;
  existing_uuid := app_private.idempotent_transaction_id(target_household, request_key); if existing_uuid is not null then return existing_uuid; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_statement::text, 0));
  select st.*, c.name as card_name into statement_record from public.statement_totals st join public.credit_cards c on c.id = st.card_id where st.id = target_statement and st.household_id = target_household;
  if not found then raise exception 'statement_not_found' using errcode = '22023'; end if;
  if amount > statement_record.remaining_cents then raise exception 'payment_exceeds_statement_balance' using errcode = '22023'; end if;
  select balance_cents into source_balance from public.account_balances where id = target_account;
  if source_balance < amount then raise exception 'insufficient_funds' using errcode = 'P0001'; end if;
  insert into public.transactions(household_id, kind, amount_cents, description, payment_method, source_account_id, card_id, statement_id, created_by, occurred_at, idempotency_key)
  values (target_household, 'card_payment', amount, 'Pagamento da fatura ' || statement_record.card_name, 'transfer', target_account, statement_record.card_id, target_statement, auth.uid(), paid_at, request_key)
  on conflict (household_id, idempotency_key) do nothing returning id into transaction_uuid;
  if transaction_uuid is null then return app_private.idempotent_transaction_id(target_household, request_key); end if;
  insert into public.ledger_entries(household_id, transaction_id, account_id, amount_cents) values (target_household, transaction_uuid, target_account, -amount);
  insert into public.statement_payments(household_id, statement_id, transaction_id, account_id, amount_cents, paid_at, created_by)
  values (target_household, target_statement, transaction_uuid, target_account, amount, paid_at, auth.uid());
  new_paid := statement_record.amount_paid_cents + amount;
  update public.card_statements set amount_paid_cents = new_paid, status = case when new_paid >= statement_record.purchase_total_cents then 'paid' else 'partially_paid' end where id = target_statement;
  return transaction_uuid;
end;
$$;

revoke all on function public.post_card_purchase(uuid, uuid, bigint, text, timestamptz, uuid, uuid) from public;
grant execute on function public.post_card_purchase(uuid, uuid, bigint, text, timestamptz, uuid, uuid) to authenticated;
revoke all on function public.pay_card_statement(uuid, uuid, uuid, bigint, timestamptz, uuid) from public;
grant execute on function public.pay_card_statement(uuid, uuid, uuid, bigint, timestamptz, uuid) to authenticated;
