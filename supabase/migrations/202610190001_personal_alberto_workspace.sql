-- Converte o antigo household compartilhado em um espaço pessoal de Alberto.
-- O email não é persistido nesta migration: usamos somente o hash já adotado pelo projeto.

do $$
declare
  alberto_user uuid;
  personal_household uuid;
begin
  select id into alberto_user
  from auth.users
  where encode(digest(lower(coalesce(email, '')), 'sha256'), 'hex') = '691f3c3d5867790e84471327fa3f2de4fd228136cca910bad248bed14a83f931'
  limit 1;

  if alberto_user is null then return; end if;

  insert into public.profiles(id, display_name, last_seen_at)
  values (alberto_user, 'Alberto', now())
  on conflict (id) do update set display_name = 'Alberto', last_seen_at = now();

  select household_id into personal_household
  from public.household_members
  where user_id = alberto_user and status = 'active'
  order by joined_at
  limit 1;

  if personal_household is null then
    insert into public.households(name, created_by) values ('Saldo.', alberto_user) returning id into personal_household;
    insert into public.household_members(household_id, user_id, role, status)
    values (personal_household, alberto_user, 'owner', 'active');
  end if;

  update public.households set name = 'Saldo.', created_by = alberto_user where id = personal_household;
  update public.household_members set role = 'owner', status = 'active', invited_by = null where household_id = personal_household and user_id = alberto_user;

  update public.accounts set owner_id = alberto_user, created_by = alberto_user where household_id = personal_household;
  update public.credit_cards set owner_id = alberto_user, created_by = alberto_user where household_id = personal_household;
  update public.categories set created_by = alberto_user where household_id = personal_household;
  update public.transactions set created_by = alberto_user where household_id = personal_household;
  update public.statement_payments set created_by = alberto_user where household_id = personal_household;
  update public.scheduled_expenses set created_by = alberto_user where household_id = personal_household;
  update public.debts set created_by = alberto_user where household_id = personal_household;
  update public.debt_payments set created_by = alberto_user where household_id = personal_household;
  update public.budgets set created_by = alberto_user where household_id = personal_household;
  update public.attachments set created_by = alberto_user where household_id = personal_household;
  update public.monthly_goals set created_by = alberto_user where household_id = personal_household;
  update public.ai_conversations set created_by = alberto_user where household_id = personal_household;
  update public.ai_messages set created_by = alberto_user where household_id = personal_household;
  update public.future_incomes set owner_id = alberto_user, created_by = alberto_user where household_id = personal_household;
  update public.audit_logs set actor_id = alberto_user where household_id = personal_household and actor_id is not null;

  delete from public.notifications where household_id = personal_household and user_id <> alberto_user;
  delete from public.notification_preferences where household_id = personal_household and user_id <> alberto_user;
  insert into public.notification_preferences(household_id, user_id)
  values (personal_household, alberto_user)
  on conflict (household_id, user_id) do update set new_transaction = true, security = true;

  delete from public.household_members where household_id = personal_household and user_id <> alberto_user;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', 'Alberto', 'must_change_password', true)
  where id = alberto_user;
end $$;

create or replace function public.bootstrap_at_household()
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user uuid := auth.uid();
  current_email_hash text := encode(digest(lower(coalesce(auth.jwt() ->> 'email', '')), 'sha256'), 'hex');
  target_household uuid;
begin
  if current_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if current_email_hash <> '691f3c3d5867790e84471327fa3f2de4fd228136cca910bad248bed14a83f931' then
    raise exception 'personal_account_only' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('saldo-personal-bootstrap', 0));
  insert into public.profiles(id, display_name, last_seen_at)
  values (current_user, 'Alberto', now())
  on conflict (id) do update set display_name = 'Alberto', last_seen_at = now();

  select hm.household_id into target_household
  from public.household_members hm
  join public.households h on h.id = hm.household_id and h.deleted_at is null
  where hm.user_id = current_user and hm.status = 'active'
  order by hm.joined_at
  limit 1;

  if target_household is null then
    insert into public.households(name, created_by) values ('Saldo.', current_user) returning id into target_household;
    insert into public.household_members(household_id, user_id, role, status)
    values (target_household, current_user, 'owner', 'active');
  else
    update public.households set name = 'Saldo.', created_by = current_user where id = target_household;
    update public.household_members set role = 'owner', status = 'active', invited_by = null where household_id = target_household and user_id = current_user;
  end if;

  insert into public.notification_preferences(household_id, user_id)
  values (target_household, current_user)
  on conflict (household_id, user_id) do nothing;
  insert into public.categories(household_id, name, created_by)
  select target_household, category_name, current_user
  from unnest(array['Alimentação','Mercado','Casa','Transporte','Lazer','Saúde','Compras','Renda extra','Entregas','Salário','Vendas','Reembolso','Outros']) as category_name
  on conflict (household_id, name) do nothing;
  return target_household;
end;
$$;

create or replace function app_private.enqueue_personal_transaction_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  formatted_amount text := replace(to_char(new.amount_cents / 100.0, 'FM999999990D00'), '.', ',');
  notification_title text;
begin
  notification_title := case
    when new.kind = 'income' then 'Entrada registrada'
    when new.kind = 'card_payment' then 'Fatura paga'
    when new.kind = 'internal_transfer' then 'Transferência registrada'
    when new.kind = 'adjustment' then 'Saldo ajustado'
    else 'Gasto registrado'
  end;
  insert into public.notifications(household_id, user_id, kind, title, body)
  select new.household_id, new.created_by, 'new_transaction', notification_title,
    'R$ ' || formatted_amount || ' · ' || left(new.description, 180)
  where coalesce((select preference.new_transaction from public.notification_preferences preference where preference.household_id = new.household_id and preference.user_id = new.created_by), true);
  return new;
end;
$$;

drop trigger if exists transactions_notify_personal on public.transactions;
create trigger transactions_notify_personal after insert on public.transactions
for each row execute function app_private.enqueue_personal_transaction_notification();

revoke all on function public.bootstrap_at_household() from public;
grant execute on function public.bootstrap_at_household() to authenticated;
