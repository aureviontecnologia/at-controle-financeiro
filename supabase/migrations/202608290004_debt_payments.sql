create or replace function public.post_debt_payment(
  target_household uuid,
  target_debt uuid,
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
declare transaction_uuid uuid; existing_uuid uuid; debt_record record; source_balance bigint; already_paid bigint;
begin
  perform app_private.assert_household_member(target_household);
  perform app_private.assert_account(target_household, target_account);
  if amount <= 0 then raise exception 'amount_must_be_positive' using errcode = '22023'; end if;
  existing_uuid := app_private.idempotent_transaction_id(target_household, request_key);
  if existing_uuid is not null then return existing_uuid; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_debt::text, 0));
  select * into debt_record from public.debts where id = target_debt and household_id = target_household and status = 'active' and deleted_at is null;
  if not found then raise exception 'debt_not_found' using errcode = '22023'; end if;
  select coalesce(sum(amount_cents), 0) into already_paid from public.debt_payments where debt_id = target_debt;
  if amount > debt_record.original_amount_cents - already_paid then raise exception 'payment_exceeds_debt_balance' using errcode = '22023'; end if;
  select balance_cents into source_balance from public.account_balances where id = target_account;
  if source_balance < amount then raise exception 'insufficient_funds' using errcode = 'P0001'; end if;
  insert into public.transactions(household_id, kind, amount_cents, description, payment_method, source_account_id, created_by, occurred_at, idempotency_key)
  values (target_household, 'debt_payment', amount, 'Pagamento: ' || debt_record.creditor, 'bank_slip', target_account, auth.uid(), paid_at, request_key)
  on conflict (household_id, idempotency_key) do nothing returning id into transaction_uuid;
  if transaction_uuid is null then return app_private.idempotent_transaction_id(target_household, request_key); end if;
  insert into public.ledger_entries(household_id, transaction_id, account_id, amount_cents) values (target_household, transaction_uuid, target_account, -amount);
  insert into public.debt_payments(household_id, debt_id, transaction_id, amount_cents, paid_at, created_by)
  values (target_household, target_debt, transaction_uuid, amount, paid_at, auth.uid());
  if already_paid + amount >= debt_record.original_amount_cents then update public.debts set status = 'paid' where id = target_debt; end if;
  return transaction_uuid;
end;
$$;

revoke all on function public.post_debt_payment(uuid, uuid, uuid, bigint, timestamptz, uuid) from public;
grant execute on function public.post_debt_payment(uuid, uuid, uuid, bigint, timestamptz, uuid) to authenticated;
