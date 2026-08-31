-- Parcelamento real: o limite considera a compra inteira e cada fatura recebe apenas sua parcela.

create table if not exists public.card_purchase_installments (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  statement_id uuid not null references public.card_statements(id) on delete restrict,
  installment_number smallint not null check (installment_number between 1 and 36),
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  unique (transaction_id, installment_number),
  unique (transaction_id, statement_id)
);

create index if not exists card_installments_statement_idx on public.card_purchase_installments(statement_id);
alter table public.card_purchase_installments enable row level security;
drop policy if exists card_installments_member_read on public.card_purchase_installments;
create policy card_installments_member_read on public.card_purchase_installments for select to authenticated using (app_private.is_household_member(household_id));
revoke insert, update, delete on public.card_purchase_installments from authenticated;
grant select on public.card_purchase_installments to authenticated;

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
  coalesce(sum(p.amount_cents), 0)::bigint as purchase_total_cents,
  s.amount_paid_cents,
  greatest(coalesce(sum(p.amount_cents), 0) - s.amount_paid_cents, 0)::bigint as remaining_cents,
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

create or replace function public.set_transaction_payment_details(
  target_transaction uuid,
  method_detail text,
  installments smallint
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  transaction_record record;
  card_record record;
  dates record;
  statement_uuid uuid;
  first_statement_uuid uuid;
  installment_index integer;
  installment_amount bigint;
  installment_date date;
begin
  perform pg_advisory_xact_lock(hashtextextended(target_transaction::text, 0));
  select household_id, created_by, kind, card_id, statement_id, amount_cents, occurred_at
  into transaction_record
  from public.transactions
  where id = target_transaction and deleted_at is null;
  if not found then raise exception 'transaction_not_found' using errcode = '22023'; end if;
  perform app_private.assert_household_member(transaction_record.household_id);
  if transaction_record.created_by <> auth.uid() then raise exception 'transaction_owner_required' using errcode = '42501'; end if;
  if installments not between 1 and 36 then raise exception 'invalid_installment_count' using errcode = '22023'; end if;
  if installments > 1 and transaction_record.kind <> 'card_purchase' then raise exception 'installments_require_card_purchase' using errcode = '22023'; end if;
  if installments > transaction_record.amount_cents then raise exception 'installment_amount_too_small' using errcode = '22023'; end if;

  delete from public.card_purchase_installments where transaction_id = target_transaction;
  if installments > 1 then
    select closing_day, due_day into card_record from public.credit_cards where id = transaction_record.card_id and household_id = transaction_record.household_id;
    if not found then raise exception 'card_not_found' using errcode = '22023'; end if;
    for installment_index in 1..installments loop
      installment_date := (((transaction_record.occurred_at at time zone 'America/Sao_Paulo')::date + make_interval(months => installment_index - 1))::date);
      select * into dates from app_private.statement_dates(installment_date, card_record.closing_day, card_record.due_day);
      insert into public.card_statements(household_id, card_id, period_start, period_end, closing_date, due_date)
      values (transaction_record.household_id, transaction_record.card_id, dates.period_start, dates.period_end, dates.closing_date, dates.due_date)
      on conflict (card_id, closing_date) do update set updated_at = now()
      returning id into statement_uuid;
      if installment_index = 1 then first_statement_uuid := statement_uuid; end if;
      installment_amount := (transaction_record.amount_cents / installments) + case when installment_index <= (transaction_record.amount_cents % installments) then 1 else 0 end;
      insert into public.card_purchase_installments(household_id, transaction_id, statement_id, installment_number, amount_cents)
      values (transaction_record.household_id, target_transaction, statement_uuid, installment_index, installment_amount);
    end loop;
  else
    first_statement_uuid := transaction_record.statement_id;
  end if;

  update public.transactions
  set payment_method_detail = nullif(trim(method_detail), ''), installment_count = installments, statement_id = first_statement_uuid, updated_at = now()
  where id = target_transaction;
end;
$$;

create or replace function public.post_card_purchase_detailed(
  target_household uuid,
  target_card uuid,
  amount bigint,
  item_description text,
  purchased_at timestamptz,
  request_key uuid,
  target_category uuid default null,
  method_detail text default null,
  installments smallint default 1
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare transaction_uuid uuid;
begin
  transaction_uuid := public.post_card_purchase(target_household, target_card, amount, item_description, purchased_at, request_key, target_category);
  perform public.set_transaction_payment_details(transaction_uuid, method_detail, installments);
  return transaction_uuid;
end;
$$;

revoke all on function public.set_transaction_payment_details(uuid, text, smallint) from public;
revoke all on function public.post_card_purchase_detailed(uuid, uuid, bigint, text, timestamptz, uuid, uuid, text, smallint) from public;
grant execute on function public.set_transaction_payment_details(uuid, text, smallint) to authenticated;
grant execute on function public.post_card_purchase_detailed(uuid, uuid, bigint, text, timestamptz, uuid, uuid, text, smallint) to authenticated;
