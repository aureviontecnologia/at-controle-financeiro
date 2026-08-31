-- Impede saldo negativo por gastos concorrentes na mesma conta ou dinheiro.

create or replace function public.post_expense(
  target_household uuid,
  target_account uuid,
  amount bigint,
  item_description text,
  paid_at timestamptz,
  method public.payment_method,
  request_key uuid,
  target_category uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  transaction_uuid uuid;
  existing_uuid uuid;
  available_balance bigint;
begin
  perform app_private.assert_household_member(target_household);
  perform app_private.assert_account(target_household, target_account);
  if amount <= 0 then raise exception 'amount_must_be_positive' using errcode = '22023'; end if;
  if char_length(trim(item_description)) not between 1 and 240 then raise exception 'invalid_description' using errcode = '22023'; end if;
  existing_uuid := app_private.idempotent_transaction_id(target_household, request_key);
  if existing_uuid is not null then return existing_uuid; end if;

  perform pg_advisory_xact_lock(hashtextextended(target_account::text, 0));
  select balance_cents into available_balance
  from public.account_balances
  where id = target_account and household_id = target_household;
  if available_balance < amount then raise exception 'insufficient_funds' using errcode = 'P0001'; end if;

  insert into public.transactions(household_id, kind, amount_cents, description, category_id, payment_method, source_account_id, created_by, occurred_at, idempotency_key)
  values (target_household, 'expense', amount, trim(item_description), target_category, method, target_account, auth.uid(), paid_at, request_key)
  on conflict (household_id, idempotency_key) do nothing returning id into transaction_uuid;
  if transaction_uuid is null then return app_private.idempotent_transaction_id(target_household, request_key); end if;
  insert into public.ledger_entries(household_id, transaction_id, account_id, amount_cents)
  values (target_household, transaction_uuid, target_account, -amount);
  return transaction_uuid;
end;
$$;

revoke all on function public.post_expense(uuid, uuid, bigint, text, timestamptz, public.payment_method, uuid, uuid) from public;
grant execute on function public.post_expense(uuid, uuid, bigint, text, timestamptz, public.payment_method, uuid, uuid) to authenticated;
