-- Assistente autenticado sem dependência de service-role legado, assinaturas e cofres.

create or replace function public.get_ai_chat_context(target_household uuid, target_conversation uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  perform app_private.assert_household_member(target_household);
  if not exists (
    select 1 from public.ai_conversations
    where id = target_conversation and household_id = target_household and deleted_at is null
  ) then raise exception 'conversation_not_found' using errcode = '22023'; end if;

  select jsonb_build_object(
    'messages', coalesce(jsonb_agg(jsonb_build_object('role', role, 'content', content) order by created_at), '[]'::jsonb),
    'minute_count', (select count(*) from public.ai_usage where user_id = auth.uid() and created_at >= now() - interval '1 minute'),
    'day_count', (select count(*) from public.ai_usage where user_id = auth.uid() and created_at >= now() - interval '1 day')
  ) into result
  from (
    select role, content, created_at
    from public.ai_messages
    where household_id = target_household and conversation_id = target_conversation
    order by created_at desc limit 12
  ) recent;
  return result;
end;
$$;

create or replace function public.save_ai_exchange(
  target_household uuid,
  target_conversation uuid,
  question text,
  answer text,
  request_digest text,
  model_name text,
  prompt_token_count integer default null,
  completion_token_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare question_row public.ai_messages;
declare answer_row public.ai_messages;
begin
  perform app_private.assert_household_member(target_household);
  if char_length(trim(question)) not between 2 and 500 or char_length(trim(answer)) not between 1 and 4000 then
    raise exception 'invalid_ai_exchange' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.ai_conversations
    where id = target_conversation and household_id = target_household and deleted_at is null
  ) then raise exception 'conversation_not_found' using errcode = '22023'; end if;

  insert into public.ai_messages(household_id, conversation_id, role, content, created_by)
  values (target_household, target_conversation, 'user', trim(question), auth.uid()) returning * into question_row;
  insert into public.ai_messages(household_id, conversation_id, role, content, created_by)
  values (target_household, target_conversation, 'assistant', trim(answer), auth.uid()) returning * into answer_row;
  update public.ai_conversations set updated_at = now() where id = target_conversation and household_id = target_household;
  insert into public.ai_usage(household_id, user_id, request_hash, model, prompt_tokens, completion_tokens, status)
  values (target_household, auth.uid(), left(request_digest, 128), left(model_name, 120), prompt_token_count, completion_token_count, 'success');

  return jsonb_build_object('messages', jsonb_build_array(
    jsonb_build_object('id', question_row.id, 'conversationId', question_row.conversation_id, 'role', question_row.role, 'text', question_row.content, 'createdBy', question_row.created_by, 'createdAt', question_row.created_at),
    jsonb_build_object('id', answer_row.id, 'conversationId', answer_row.conversation_id, 'role', answer_row.role, 'text', answer_row.content, 'createdBy', answer_row.created_by, 'createdAt', answer_row.created_at)
  ));
end;
$$;

revoke all on function public.get_ai_chat_context(uuid, uuid) from public;
revoke all on function public.save_ai_exchange(uuid, uuid, text, text, text, text, integer, integer) from public;
grant execute on function public.get_ai_chat_context(uuid, uuid) to authenticated;
grant execute on function public.save_ai_exchange(uuid, uuid, text, text, text, text, integer, integer) to authenticated;

alter table public.scheduled_expenses add column if not exists payment_method public.payment_method;
alter table public.scheduled_expenses add column if not exists payment_method_detail text;
alter table public.scheduled_expenses add column if not exists last_paid_at timestamptz;
alter table public.scheduled_expenses add column if not exists last_transaction_id uuid references public.transactions(id);
alter table public.scheduled_expenses drop constraint if exists scheduled_payment_method_detail_check;
alter table public.scheduled_expenses add constraint scheduled_payment_method_detail_check check (payment_method_detail is null or char_length(payment_method_detail) between 2 and 40);

create table if not exists public.savings_pots (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  balance_cents bigint not null default 0 check (balance_cents >= 0),
  target_cents bigint check (target_cents is null or target_cents > 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create index if not exists savings_pots_account_idx on public.savings_pots(account_id) where archived_at is null;
alter table public.savings_pots enable row level security;
drop policy if exists savings_pots_member_read on public.savings_pots;
create policy savings_pots_member_read on public.savings_pots for select to authenticated using (app_private.is_household_member(household_id));
revoke all on table public.savings_pots from public, anon;
grant select on table public.savings_pots to authenticated;

create or replace function app_private.account_spendable_cents(target_household uuid, target_account uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(ab.balance_cents, 0) - coalesce((select sum(sp.balance_cents) from public.savings_pots sp where sp.account_id = target_account and sp.household_id = target_household and sp.archived_at is null), 0)
  from public.account_balances ab where ab.id = target_account and ab.household_id = target_household
$$;

create or replace function public.create_savings_pot(target_household uuid, target_account uuid, pot_name text, opening_amount bigint, target_amount bigint default null)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare pot_id uuid;
begin
  perform app_private.assert_household_member(target_household);
  perform app_private.assert_account(target_household, target_account);
  if char_length(trim(pot_name)) not between 2 and 80 or opening_amount < 0 or (target_amount is not null and target_amount <= 0) then raise exception 'invalid_savings_pot' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_account::text, 0));
  if app_private.account_spendable_cents(target_household, target_account) < opening_amount then raise exception 'insufficient_spendable_funds' using errcode = 'P0001'; end if;
  insert into public.savings_pots(household_id, account_id, name, balance_cents, target_cents, created_by)
  values (target_household, target_account, trim(pot_name), opening_amount, target_amount, auth.uid()) returning id into pot_id;
  return pot_id;
end;
$$;

create or replace function public.adjust_savings_pot(target_household uuid, target_pot uuid, amount_delta bigint)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare pot public.savings_pots;
declare next_balance bigint;
begin
  perform app_private.assert_household_member(target_household);
  select * into pot from public.savings_pots where id = target_pot and household_id = target_household and archived_at is null for update;
  if not found or amount_delta = 0 then raise exception 'invalid_savings_adjustment' using errcode = '22023'; end if;
  next_balance := pot.balance_cents + amount_delta;
  if next_balance < 0 then raise exception 'insufficient_pot_funds' using errcode = 'P0001'; end if;
  if amount_delta > 0 and app_private.account_spendable_cents(target_household, pot.account_id) < amount_delta then raise exception 'insufficient_spendable_funds' using errcode = 'P0001'; end if;
  update public.savings_pots set balance_cents = next_balance, updated_at = now() where id = target_pot;
  return next_balance;
end;
$$;

revoke all on function public.create_savings_pot(uuid, uuid, text, bigint, bigint) from public;
revoke all on function public.adjust_savings_pot(uuid, uuid, bigint) from public;
grant execute on function public.create_savings_pot(uuid, uuid, text, bigint, bigint) to authenticated;
grant execute on function public.adjust_savings_pot(uuid, uuid, bigint) to authenticated;

create or replace function public.post_expense(
  target_household uuid, target_account uuid, amount bigint, item_description text,
  paid_at timestamptz, method public.payment_method, request_key uuid, target_category uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, app_private, pg_temp
as $$
declare transaction_uuid uuid;
declare existing_uuid uuid;
begin
  perform app_private.assert_household_member(target_household);
  perform app_private.assert_account(target_household, target_account);
  if amount <= 0 then raise exception 'amount_must_be_positive' using errcode = '22023'; end if;
  if char_length(trim(item_description)) not between 1 and 240 then raise exception 'invalid_description' using errcode = '22023'; end if;
  existing_uuid := app_private.idempotent_transaction_id(target_household, request_key);
  if existing_uuid is not null then return existing_uuid; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_account::text, 0));
  if app_private.account_spendable_cents(target_household, target_account) < amount then raise exception 'insufficient_funds' using errcode = 'P0001'; end if;
  insert into public.transactions(household_id, kind, amount_cents, description, category_id, payment_method, source_account_id, created_by, occurred_at, idempotency_key)
  values (target_household, 'expense', amount, trim(item_description), target_category, method, target_account, auth.uid(), paid_at, request_key)
  on conflict (household_id, idempotency_key) do nothing returning id into transaction_uuid;
  if transaction_uuid is null then return app_private.idempotent_transaction_id(target_household, request_key); end if;
  insert into public.ledger_entries(household_id, transaction_id, account_id, amount_cents) values (target_household, transaction_uuid, target_account, -amount);
  return transaction_uuid;
end;
$$;
revoke all on function public.post_expense(uuid, uuid, bigint, text, timestamptz, public.payment_method, uuid, uuid) from public;
grant execute on function public.post_expense(uuid, uuid, bigint, text, timestamptz, public.payment_method, uuid, uuid) to authenticated;

create or replace function public.pay_scheduled_expense(
  target_household uuid, target_schedule uuid, target_source uuid, source_kind text,
  method public.payment_method, method_detail text, paid_at timestamptz, request_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare schedule public.scheduled_expenses;
declare transaction_id uuid;
declare next_date date;
begin
  perform app_private.assert_household_member(target_household);
  select * into schedule from public.scheduled_expenses where id = target_schedule and household_id = target_household and deleted_at is null and status = 'active' for update;
  if not found then raise exception 'schedule_not_found' using errcode = '22023'; end if;
  if source_kind = 'card' then
    transaction_id := public.post_card_purchase_detailed(target_household, target_source, schedule.amount_cents, schedule.title, paid_at, request_key, schedule.category_id, method_detail, 1);
  elsif source_kind = 'account' then
    transaction_id := public.post_expense(target_household, target_source, schedule.amount_cents, schedule.title, paid_at, method, request_key, schedule.category_id);
    if method_detail is not null and char_length(trim(method_detail)) >= 2 then perform public.set_transaction_payment_details(transaction_id, trim(method_detail), 1); end if;
  else raise exception 'invalid_source_kind' using errcode = '22023'; end if;
  if schedule.recurrence_rule = 'FREQ=MONTHLY' then
    next_date := (date_trunc('month', schedule.due_date) + interval '2 month - 1 day')::date;
    next_date := make_date(extract(year from next_date)::int, extract(month from next_date)::int, least(extract(day from schedule.due_date)::int, extract(day from next_date)::int));
    update public.scheduled_expenses set due_date = next_date, last_paid_at = paid_at, last_transaction_id = transaction_id, payment_method = method, payment_method_detail = nullif(trim(method_detail), ''), updated_at = now() where id = target_schedule;
  else
    update public.scheduled_expenses set status = 'completed', last_paid_at = paid_at, last_transaction_id = transaction_id, payment_method = method, payment_method_detail = nullif(trim(method_detail), ''), updated_at = now() where id = target_schedule;
  end if;
  return transaction_id;
end;
$$;

revoke all on function public.pay_scheduled_expense(uuid, uuid, uuid, text, public.payment_method, text, timestamptz, uuid) from public;
grant execute on function public.pay_scheduled_expense(uuid, uuid, uuid, text, public.payment_method, text, timestamptz, uuid) to authenticated;

do $$ begin alter publication supabase_realtime add table public.savings_pots; exception when duplicate_object then null; end $$;
