-- Contexto rico do assistente e avisos para toda atividade financeira do parceiro.

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

  with totals as (
    select
      (select coalesce(sum(balance_cents), 0) from public.account_balances where household_id = target_household)::bigint available_cents,
      (select coalesce(sum(remaining_cents), 0) from public.statement_totals where household_id = target_household and status <> 'paid')::bigint open_card_cents,
      (select coalesce(sum(d.original_amount_cents - coalesce(p.paid_cents, 0)), 0)
        from public.debts d
        left join (select debt_id, sum(amount_cents)::bigint paid_cents from public.debt_payments where household_id = target_household group by debt_id) p on p.debt_id = d.id
        where d.household_id = target_household and d.status = 'active' and d.deleted_at is null)::bigint external_debt_cents
  )
  select jsonb_build_object(
    'currency', h.currency,
    'generated_at', now(),
    'available_cents', totals.available_cents,
    'open_card_cents', totals.open_card_cents,
    'external_debt_cents', totals.external_debt_cents,
    'net_position_cents', totals.available_cents - totals.open_card_cents - totals.external_debt_cents,
    'month_income_cents', (select coalesce(sum(amount_cents), 0) from public.transactions where household_id = h.id and kind = 'income' and status = 'posted' and deleted_at is null and occurred_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo')),
    'month_expense_cents', (select coalesce(sum(amount_cents), 0) from public.transactions where household_id = h.id and kind in ('expense', 'card_purchase') and status = 'posted' and deleted_at is null and occurred_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo')),
    'upcoming_cents', (select coalesce(sum(amount_cents), 0) from public.scheduled_expenses where household_id = h.id and status = 'active' and deleted_at is null and due_date >= current_date),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('name', a.name, 'institution', a.institution, 'kind', a.kind, 'owner', p.display_name, 'balance_cents', a.balance_cents) order by a.balance_cents desc), '[]'::jsonb) from public.account_balances a join public.profiles p on p.id = a.owner_id where a.household_id = h.id),
    'cards', (select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'owner', p.display_name, 'limit_cents', c.limit_cents + c.additional_limit_cents, 'invoice_cents', coalesce(s.invoice_cents, 0), 'available_limit_cents', greatest(c.limit_cents + c.additional_limit_cents - coalesce(s.invoice_cents, 0), 0), 'closing_day', c.closing_day, 'due_day', c.due_day)), '[]'::jsonb) from public.credit_cards c join public.profiles p on p.id = c.owner_id left join (select card_id, sum(remaining_cents)::bigint invoice_cents from public.statement_totals where household_id = h.id and status <> 'paid' group by card_id) s on s.card_id = c.id where c.household_id = h.id and c.is_active and c.archived_at is null),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'spent_cents', spent_cents) order by spent_cents desc), '[]'::jsonb) from (select c.name, sum(t.amount_cents)::bigint spent_cents from public.transactions t join public.categories c on c.id = t.category_id where t.household_id = h.id and t.kind in ('expense', 'card_purchase') and t.status = 'posted' and t.deleted_at is null and t.occurred_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') group by c.name order by spent_cents desc limit 12) grouped),
    'recent_transactions', (select coalesce(jsonb_agg(item order by occurred_at desc), '[]'::jsonb) from (select jsonb_build_object('kind', t.kind, 'amount_cents', t.amount_cents, 'description', t.description, 'category', coalesce(c.name, 'Outros'), 'payment_method', t.payment_method, 'created_by', p.display_name, 'occurred_at', t.occurred_at) item, t.occurred_at from public.transactions t left join public.categories c on c.id = t.category_id join public.profiles p on p.id = t.created_by where t.household_id = h.id and t.status = 'posted' and t.deleted_at is null order by t.occurred_at desc limit 40) recent),
    'budgets', (select coalesce(jsonb_agg(jsonb_build_object('category', c.name, 'limit_cents', b.limit_cents, 'spent_cents', coalesce(spent.amount_cents, 0))), '[]'::jsonb) from public.budgets b join public.categories c on c.id = b.category_id left join (select category_id, sum(amount_cents)::bigint amount_cents from public.transactions where household_id = h.id and kind in ('expense', 'card_purchase') and status = 'posted' and deleted_at is null and occurred_at >= date_trunc('month', now() at time zone 'America/Sao_Paulo') group by category_id) spent on spent.category_id = b.category_id where b.household_id = h.id and b.month = date_trunc('month', now() at time zone 'America/Sao_Paulo')::date),
    'upcoming', (select coalesce(jsonb_agg(jsonb_build_object('title', title, 'amount_cents', amount_cents, 'due_date', due_date) order by due_date), '[]'::jsonb) from public.scheduled_expenses where household_id = h.id and status = 'active' and deleted_at is null and due_date >= current_date limit 20),
    'monthly_goal', (select jsonb_build_object('target_cents', target_cents, 'target_day', target_day, 'month', month) from public.monthly_goals where household_id = h.id and month = date_trunc('month', now() at time zone 'America/Sao_Paulo')::date limit 1)
  ) into result
  from public.households h cross join totals
  where h.id = target_household and h.deleted_at is null;

  return result;
end;
$$;

revoke all on function public.get_financial_ai_context(uuid) from public;
grant execute on function public.get_financial_ai_context(uuid) to authenticated;

create or replace function app_private.enqueue_new_expense_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_name text;
  formatted_amount text;
  notification_title text;
  notification_verb text;
begin
  if new.status <> 'posted' or new.deleted_at is not null then return new; end if;
  select display_name into actor_name from public.profiles where id = new.created_by;
  actor_name := coalesce(actor_name, 'Um membro');
  formatted_amount := replace(to_char(new.amount_cents / 100.0, 'FM999999990D00'), '.', ',');
  notification_title := case new.kind
    when 'income' then 'Nova entrada de ' || actor_name
    when 'internal_transfer' then 'Transferência de ' || actor_name
    when 'card_payment' then 'Fatura paga por ' || actor_name
    when 'debt_payment' then 'Compromisso pago por ' || actor_name
    when 'adjustment' then 'Saldo atualizado por ' || actor_name
    else 'Novo gasto de ' || actor_name end;
  notification_verb := case new.kind
    when 'income' then ' adicionou uma entrada de '
    when 'internal_transfer' then ' transferiu '
    when 'card_payment' then ' pagou uma fatura de '
    when 'debt_payment' then ' registrou um pagamento de '
    when 'adjustment' then ' ajustou '
    else ' adicionou um gasto de ' end;

  insert into public.notifications(household_id, user_id, kind, title, body)
  select new.household_id, member.user_id, 'new_transaction', notification_title,
    actor_name || notification_verb || 'R$ ' || formatted_amount || ' · ' || left(new.description, 180)
  from public.household_members member
  left join public.notification_preferences preference on preference.household_id = member.household_id and preference.user_id = member.user_id
  where member.household_id = new.household_id and member.status = 'active' and member.user_id <> new.created_by and coalesce(preference.new_transaction, true);
  return new;
end;
$$;

create or replace function app_private.enqueue_resource_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare actor uuid; actor_name text; title_text text; body_text text; amount bigint;
begin
  actor := coalesce(auth.uid(), new.created_by);
  if actor is null then return new; end if;
  select display_name into actor_name from public.profiles where id = actor;
  actor_name := coalesce(actor_name, 'Um membro');

  if tg_table_name = 'accounts' then
    amount := new.opening_balance_cents;
    title_text := 'Conta adicionada por ' || actor_name;
    body_text := actor_name || ' adicionou ' || left(new.name, 80) || ' com saldo de R$ ' || replace(to_char(amount / 100.0, 'FM999999990D00'), '.', ',');
  elsif tg_table_name = 'credit_cards' then
    amount := new.limit_cents + new.additional_limit_cents;
    title_text := 'Cartão adicionado por ' || actor_name;
    body_text := actor_name || ' adicionou ' || left(new.name, 80) || ' com limite de R$ ' || replace(to_char(amount / 100.0, 'FM999999990D00'), '.', ',');
  elsif tg_table_name = 'monthly_goals' then
    amount := new.target_cents;
    title_text := 'Meta atualizada por ' || actor_name;
    body_text := actor_name || ' definiu a meta em R$ ' || replace(to_char(amount / 100.0, 'FM999999990D00'), '.', ',') || ' até o dia ' || new.target_day;
  else
    amount := new.amount_cents;
    title_text := 'Conta prevista por ' || actor_name;
    body_text := actor_name || ' adicionou ' || left(new.title, 120) || ' · R$ ' || replace(to_char(amount / 100.0, 'FM999999990D00'), '.', ',');
  end if;

  insert into public.notifications(household_id, user_id, kind, title, body)
  select new.household_id, member.user_id, 'new_transaction', title_text, body_text
  from public.household_members member
  left join public.notification_preferences preference on preference.household_id = member.household_id and preference.user_id = member.user_id
  where member.household_id = new.household_id and member.status = 'active' and member.user_id <> actor and coalesce(preference.new_transaction, true);
  return new;
end;
$$;

drop trigger if exists accounts_notify_household on public.accounts;
create trigger accounts_notify_household after insert on public.accounts for each row execute function app_private.enqueue_resource_notification();
drop trigger if exists cards_notify_household on public.credit_cards;
create trigger cards_notify_household after insert on public.credit_cards for each row execute function app_private.enqueue_resource_notification();
drop trigger if exists goals_notify_household on public.monthly_goals;
create trigger goals_notify_household after insert or update on public.monthly_goals for each row execute function app_private.enqueue_resource_notification();
drop trigger if exists scheduled_notify_household on public.scheduled_expenses;
create trigger scheduled_notify_household after insert on public.scheduled_expenses for each row execute function app_private.enqueue_resource_notification();
