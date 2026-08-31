-- Fatura inicial informada ao cadastrar um cartão.

alter table public.card_statements
  add column if not exists opening_balance_cents bigint not null default 0
  check (opening_balance_cents >= 0);

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
  (s.opening_balance_cents + coalesce(sum(p.amount_cents), 0))::bigint as purchase_total_cents,
  s.amount_paid_cents,
  greatest(s.opening_balance_cents + coalesce(sum(p.amount_cents), 0) - s.amount_paid_cents, 0)::bigint as remaining_cents,
  s.status
from public.card_statements s
left join (
  select i.statement_id, i.amount_cents
  from public.card_purchase_installments i
  join public.transactions t on t.id = i.transaction_id
  where t.kind = 'card_purchase' and t.status = 'posted' and t.deleted_at is null
  union all
  select t.statement_id, t.amount_cents
  from public.transactions t
  where t.kind = 'card_purchase' and t.status = 'posted' and t.deleted_at is null
    and not exists (select 1 from public.card_purchase_installments i where i.transaction_id = t.id)
) p on p.statement_id = s.id
group by s.id;

grant select on public.statement_totals to authenticated;

create or replace function public.create_credit_card_with_current_invoice(
  target_household uuid,
  card_name text,
  card_institution text,
  card_last_four text,
  card_limit bigint,
  card_closing_day smallint,
  card_due_day smallint,
  current_invoice bigint default 0,
  future_invoices jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  card_id uuid;
  statement_dates record;
  invoice jsonb;
  invoice_month date;
  invoice_amount bigint;
  invoice_due date;
  invoice_close date;
  future_total bigint;
begin
  perform app_private.assert_household_member(target_household);
  if jsonb_typeof(future_invoices) <> 'array' then
    raise exception 'invalid_future_invoices' using errcode = '22023';
  end if;
  select coalesce(sum((value ->> 'amountCents')::bigint), 0)
  into future_total from jsonb_array_elements(future_invoices);
  if char_length(trim(card_name)) not between 2 and 80
    or char_length(trim(card_institution)) not between 2 and 80
    or card_limit <= 0
    or current_invoice < 0
    or future_total < 0
    or current_invoice + future_total > card_limit
    or card_closing_day not between 1 and 31
    or card_due_day not between 1 and 31
    or (nullif(trim(card_last_four), '') is not null and trim(card_last_four) !~ '^[0-9]{4}$')
  then raise exception 'invalid_card_data' using errcode = '22023'; end if;

  insert into public.credit_cards(
    household_id, owner_id, name, institution, last_four, limit_cents,
    closing_day, due_day, created_by
  ) values (
    target_household, auth.uid(), trim(card_name), trim(card_institution),
    nullif(trim(card_last_four), ''), card_limit, card_closing_day,
    card_due_day, auth.uid()
  ) returning id into card_id;

  if current_invoice > 0 then
    select * into statement_dates
    from app_private.statement_dates(
      (now() at time zone 'America/Sao_Paulo')::date,
      card_closing_day,
      card_due_day
    );
    insert into public.card_statements(
      household_id, card_id, period_start, period_end, closing_date,
      due_date, opening_balance_cents
    ) values (
      target_household, card_id, statement_dates.period_start,
      statement_dates.period_end, statement_dates.closing_date,
      statement_dates.due_date, current_invoice
    );
  end if;

  for invoice in select value from jsonb_array_elements(future_invoices)
  loop
    invoice_month := (invoice ->> 'month')::date;
    invoice_amount := (invoice ->> 'amountCents')::bigint;
    if invoice_month <> date_trunc('month', invoice_month)::date
      or invoice_month <= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date
      or invoice_amount <= 0
    then raise exception 'invalid_future_invoice' using errcode = '22023'; end if;

    invoice_due := invoice_month + (least(card_due_day, extract(day from (invoice_month + interval '1 month - 1 day'))::int) - 1);
    if card_due_day <= card_closing_day then
      invoice_close := (invoice_month - interval '1 month')::date;
    else
      invoice_close := invoice_month;
    end if;
    invoice_close := date_trunc('month', invoice_close)::date
      + (least(card_closing_day, extract(day from (date_trunc('month', invoice_close) + interval '1 month - 1 day'))::int) - 1);

    insert into public.card_statements(
      household_id, card_id, period_start, period_end, closing_date,
      due_date, opening_balance_cents
    ) values (
      target_household, card_id,
      ((invoice_close - interval '1 month')::date + 1), invoice_close,
      invoice_close, invoice_due, invoice_amount
    )
    on conflict (card_id, closing_date) do update
      set opening_balance_cents = public.card_statements.opening_balance_cents + excluded.opening_balance_cents,
          updated_at = now();
  end loop;

  return card_id;
end;
$$;

revoke all on function public.create_credit_card_with_current_invoice(uuid, text, text, text, bigint, smallint, smallint, bigint, jsonb) from public;
grant execute on function public.create_credit_card_with_current_invoice(uuid, text, text, text, bigint, smallint, smallint, bigint, jsonb) to authenticated;
