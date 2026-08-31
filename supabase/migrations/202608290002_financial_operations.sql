-- Operacoes financeiras atomicas. O cliente nunca escreve diretamente no ledger.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.create_household(household_name text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare household_uuid uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if char_length(trim(household_name)) not between 2 and 80 then raise exception 'invalid_household_name' using errcode = '22023'; end if;
  insert into public.households(name, created_by) values (trim(household_name), auth.uid()) returning id into household_uuid;
  insert into public.household_members(household_id, user_id, role, status) values (household_uuid, auth.uid(), 'owner', 'active');
  insert into public.notification_preferences(household_id, user_id) values (household_uuid, auth.uid());
  insert into public.categories(household_id, name, color, icon, created_by) values
    (household_uuid, 'Alimentação', '#F1B96B', 'utensils', auth.uid()),
    (household_uuid, 'Mercado', '#79E2B3', 'shopping-basket', auth.uid()),
    (household_uuid, 'Casa', '#82B5FF', 'house', auth.uid()),
    (household_uuid, 'Transporte', '#A99CF7', 'car', auth.uid()),
    (household_uuid, 'Lazer', '#FF9DB5', 'ticket', auth.uid()),
    (household_uuid, 'Saúde', '#8ED6CF', 'heart-pulse', auth.uid()),
    (household_uuid, 'Compras', '#C6A7FF', 'shopping-bag', auth.uid()),
    (household_uuid, 'Renda', '#79E2B3', 'arrow-down-left', auth.uid()),
    (household_uuid, 'Outros', '#8E9B98', 'circle-ellipsis', auth.uid());
  return household_uuid;
end;
$$;

create or replace function app_private.idempotent_transaction_id(target_household uuid, key_uuid uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$ select id from public.transactions where household_id = target_household and idempotency_key = key_uuid limit 1 $$;

create or replace function app_private.assert_account(target_household uuid, target_account uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.accounts where id = target_account and household_id = target_household and archived_at is null and is_active) then
    raise exception 'account_not_found' using errcode = '22023';
  end if;
end;
$$;

create or replace function app_private.assert_card(target_household uuid, target_card uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.credit_cards where id = target_card and household_id = target_household and archived_at is null and is_active) then
    raise exception 'card_not_found' using errcode = '22023';
  end if;
end;
$$;

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
declare transaction_uuid uuid; existing_uuid uuid;
begin
  perform app_private.assert_household_member(target_household);
  perform app_private.assert_account(target_household, target_account);
  if amount <= 0 then raise exception 'amount_must_be_positive' using errcode = '22023'; end if;
  if char_length(trim(item_description)) not between 1 and 240 then raise exception 'invalid_description' using errcode = '22023'; end if;
  existing_uuid := app_private.idempotent_transaction_id(target_household, request_key);
  if existing_uuid is not null then return existing_uuid; end if;
  insert into public.transactions(household_id, kind, amount_cents, description, category_id, payment_method, source_account_id, created_by, occurred_at, idempotency_key)
  values (target_household, 'expense', amount, trim(item_description), target_category, method, target_account, auth.uid(), paid_at, request_key)
  on conflict (household_id, idempotency_key) do nothing returning id into transaction_uuid;
  if transaction_uuid is null then return app_private.idempotent_transaction_id(target_household, request_key); end if;
  insert into public.ledger_entries(household_id, transaction_id, account_id, amount_cents) values (target_household, transaction_uuid, target_account, -amount);
  return transaction_uuid;
end;
$$;

create or replace function public.post_income(
  target_household uuid,
  target_account uuid,
  amount bigint,
  item_description text,
  received_at timestamptz,
  request_key uuid,
  target_category uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare transaction_uuid uuid; existing_uuid uuid;
begin
  perform app_private.assert_household_member(target_household);
  perform app_private.assert_account(target_household, target_account);
  if amount <= 0 then raise exception 'amount_must_be_positive' using errcode = '22023'; end if;
  existing_uuid := app_private.idempotent_transaction_id(target_household, request_key);
  if existing_uuid is not null then return existing_uuid; end if;
  insert into public.transactions(household_id, kind, amount_cents, description, category_id, payment_method, destination_account_id, created_by, occurred_at, idempotency_key)
  values (target_household, 'income', amount, trim(item_description), target_category, 'transfer', target_account, auth.uid(), received_at, request_key)
  on conflict (household_id, idempotency_key) do nothing returning id into transaction_uuid;
  if transaction_uuid is null then return app_private.idempotent_transaction_id(target_household, request_key); end if;
  insert into public.ledger_entries(household_id, transaction_id, account_id, amount_cents) values (target_household, transaction_uuid, target_account, amount);
  return transaction_uuid;
end;
$$;

create or replace function public.post_internal_transfer(
  target_household uuid,
  source_account uuid,
  destination_account uuid,
  amount bigint,
  transferred_at timestamptz,
  request_key uuid,
  item_description text default 'Transferência entre contas do household'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare transaction_uuid uuid; existing_uuid uuid; source_balance bigint;
begin
  perform app_private.assert_household_member(target_household);
  perform app_private.assert_account(target_household, source_account);
  perform app_private.assert_account(target_household, destination_account);
  if source_account = destination_account then raise exception 'accounts_must_differ' using errcode = '22023'; end if;
  if amount <= 0 then raise exception 'amount_must_be_positive' using errcode = '22023'; end if;
  existing_uuid := app_private.idempotent_transaction_id(target_household, request_key);
  if existing_uuid is not null then return existing_uuid; end if;
  perform pg_advisory_xact_lock(hashtextextended(source_account::text, 0));
  select balance_cents into source_balance from public.account_balances where id = source_account;
  if source_balance < amount then raise exception 'insufficient_funds' using errcode = 'P0001'; end if;
  insert into public.transactions(household_id, kind, amount_cents, description, payment_method, source_account_id, destination_account_id, created_by, occurred_at, idempotency_key)
  values (target_household, 'internal_transfer', amount, trim(item_description), 'transfer', source_account, destination_account, auth.uid(), transferred_at, request_key)
  on conflict (household_id, idempotency_key) do nothing returning id into transaction_uuid;
  if transaction_uuid is null then return app_private.idempotent_transaction_id(target_household, request_key); end if;
  insert into public.ledger_entries(household_id, transaction_id, account_id, amount_cents) values
    (target_household, transaction_uuid, source_account, -amount),
    (target_household, transaction_uuid, destination_account, amount);
  return transaction_uuid;
end;
$$;

create or replace function app_private.statement_dates(purchase_date date, closing_day smallint, due_day smallint)
returns table(period_start date, period_end date, closing_date date, due_date date)
language plpgsql immutable set search_path = public, pg_temp as $$
declare base_month date; close_candidate date; previous_close date;
begin
  base_month := date_trunc('month', purchase_date)::date;
  close_candidate := base_month + (least(closing_day, extract(day from (base_month + interval '1 month - 1 day'))::int) - 1);
  if purchase_date > close_candidate then
    base_month := (base_month + interval '1 month')::date;
    close_candidate := base_month + (least(closing_day, extract(day from (base_month + interval '1 month - 1 day'))::int) - 1);
  end if;
  previous_close := (close_candidate - interval '1 month')::date;
  period_start := previous_close + 1;
  period_end := close_candidate;
  closing_date := close_candidate;
  if due_day <= closing_day then base_month := (base_month + interval '1 month')::date; end if;
  due_date := base_month + (least(due_day, extract(day from (base_month + interval '1 month - 1 day'))::int) - 1);
  return next;
end;
$$;

create or replace function public.post_card_purchase(
  target_household uuid,
  target_card uuid,
  amount bigint,
  item_description text,
  purchased_at timestamptz,
  request_key uuid,
  target_category uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare transaction_uuid uuid; existing_uuid uuid; statement_uuid uuid; dates record; card_record record; used bigint;
begin
  perform app_private.assert_household_member(target_household);
  perform app_private.assert_card(target_household, target_card);
  if amount <= 0 then raise exception 'amount_must_be_positive' using errcode = '22023'; end if;
  existing_uuid := app_private.idempotent_transaction_id(target_household, request_key);
  if existing_uuid is not null then return existing_uuid; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_card::text, 0));
  select * into card_record from public.credit_cards where id = target_card;
  select coalesce(sum(st.remaining_cents), 0) into used from public.statement_totals st where st.card_id = target_card;
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
declare transaction_uuid uuid; existing_uuid uuid; statement_record record; source_balance bigint; new_paid bigint;
begin
  perform app_private.assert_household_member(target_household);
  perform app_private.assert_account(target_household, target_account);
  if amount <= 0 then raise exception 'amount_must_be_positive' using errcode = '22023'; end if;
  existing_uuid := app_private.idempotent_transaction_id(target_household, request_key);
  if existing_uuid is not null then return existing_uuid; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_statement::text, 0));
  select * into statement_record from public.statement_totals where id = target_statement and household_id = target_household;
  if not found then raise exception 'statement_not_found' using errcode = '22023'; end if;
  if amount > statement_record.remaining_cents then raise exception 'payment_exceeds_statement_balance' using errcode = '22023'; end if;
  select balance_cents into source_balance from public.account_balances where id = target_account;
  if source_balance < amount then raise exception 'insufficient_funds' using errcode = 'P0001'; end if;
  insert into public.transactions(household_id, kind, amount_cents, description, payment_method, source_account_id, statement_id, created_by, occurred_at, idempotency_key)
  values (target_household, 'card_payment', amount, 'Pagamento de fatura', 'bank_slip', target_account, target_statement, auth.uid(), paid_at, request_key)
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

create or replace function public.get_financial_ai_context(target_household uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  perform app_private.assert_household_member(target_household);
  select jsonb_build_object(
    'currency', h.currency,
    'available_cents', (select coalesce(sum(balance_cents), 0) from public.account_balances where household_id = h.id),
    'open_card_cents', (select coalesce(sum(remaining_cents), 0) from public.statement_totals where household_id = h.id and status <> 'paid'),
    'month_income_cents', (select coalesce(sum(amount_cents), 0) from public.transactions where household_id = h.id and kind = 'income' and status = 'posted' and deleted_at is null and occurred_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo')),
    'month_expense_cents', (select coalesce(sum(amount_cents), 0) from public.transactions where household_id = h.id and kind in ('expense', 'card_purchase') and status = 'posted' and deleted_at is null and occurred_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo')),
    'upcoming_cents', (select coalesce(sum(amount_cents), 0) from public.scheduled_expenses where household_id = h.id and status = 'active' and deleted_at is null and due_date >= current_date),
    'categories', (
      select coalesce(jsonb_agg(jsonb_build_object('name', name, 'spent_cents', spent_cents) order by spent_cents desc), '[]'::jsonb)
      from (
        select c.name, sum(t.amount_cents)::bigint spent_cents
        from public.transactions t join public.categories c on c.id = t.category_id
        where t.household_id = h.id and t.kind in ('expense', 'card_purchase') and t.status = 'posted' and t.deleted_at is null and t.occurred_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo')
        group by c.name order by spent_cents desc limit 10
      ) grouped
    )
  ) into result from public.households h where h.id = target_household;
  return result;
end;
$$;

revoke all on function public.create_household(text) from public;
revoke all on function public.post_expense(uuid, uuid, bigint, text, timestamptz, public.payment_method, uuid, uuid) from public;
revoke all on function public.post_income(uuid, uuid, bigint, text, timestamptz, uuid, uuid) from public;
revoke all on function public.post_internal_transfer(uuid, uuid, uuid, bigint, timestamptz, uuid, text) from public;
revoke all on function public.post_card_purchase(uuid, uuid, bigint, text, timestamptz, uuid, uuid) from public;
revoke all on function public.pay_card_statement(uuid, uuid, uuid, bigint, timestamptz, uuid) from public;
revoke all on function public.get_financial_ai_context(uuid) from public;

grant execute on function public.create_household(text) to authenticated;
grant execute on function public.post_expense(uuid, uuid, bigint, text, timestamptz, public.payment_method, uuid, uuid) to authenticated;
grant execute on function public.post_income(uuid, uuid, bigint, text, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.post_internal_transfer(uuid, uuid, uuid, bigint, timestamptz, uuid, text) to authenticated;
grant execute on function public.post_card_purchase(uuid, uuid, bigint, text, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.pay_card_statement(uuid, uuid, uuid, bigint, timestamptz, uuid) to authenticated;
grant execute on function public.get_financial_ai_context(uuid) to authenticated;

-- Arquivos: bucket privado, caminho obrigatoriamente inicia com household_id.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('financial-attachments', 'financial-attachments', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy attachments_storage_member_read on storage.objects for select to authenticated using (
  bucket_id = 'financial-attachments'
  and app_private.is_household_member((storage.foldername(name))[1]::uuid)
);
create policy attachments_storage_member_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'financial-attachments'
  and app_private.is_household_member((storage.foldername(name))[1]::uuid)
  and lower(storage.extension(name)) in ('jpg', 'jpeg', 'png', 'webp', 'pdf')
);
create policy attachments_storage_member_delete on storage.objects for delete to authenticated using (
  bucket_id = 'financial-attachments'
  and app_private.is_household_member((storage.foldername(name))[1]::uuid)
);
