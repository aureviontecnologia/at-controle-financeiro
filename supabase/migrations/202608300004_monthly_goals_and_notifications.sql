-- Meta mensal compartilhada e avisos persistentes de novos gastos.

create table if not exists public.monthly_goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  target_cents bigint not null check (target_cents between 1 and 1000000000000),
  target_day smallint not null check (target_day between 1 and 31),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, month)
);

drop trigger if exists monthly_goals_updated on public.monthly_goals;
create trigger monthly_goals_updated before update on public.monthly_goals
for each row execute function public.set_updated_at();

alter table public.monthly_goals enable row level security;
drop policy if exists monthly_goals_member_read on public.monthly_goals;
create policy monthly_goals_member_read on public.monthly_goals for select to authenticated
using (app_private.is_household_member(household_id));

revoke insert, update, delete on public.monthly_goals from authenticated;
grant select on public.monthly_goals to authenticated;

create or replace function public.upsert_monthly_goal(
  target_household uuid,
  target_amount bigint,
  deadline_day smallint
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_month date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  goal_id uuid;
begin
  perform app_private.assert_household_member(target_household);
  if target_amount < 1 or target_amount > 1000000000000 then
    raise exception 'invalid_goal_amount' using errcode = '22023';
  end if;
  if deadline_day not between 1 and 31 then
    raise exception 'invalid_goal_day' using errcode = '22023';
  end if;

  insert into public.monthly_goals(household_id, month, target_cents, target_day, created_by)
  values (target_household, current_month, target_amount, deadline_day, auth.uid())
  on conflict (household_id, month) do update
  set target_cents = excluded.target_cents, target_day = excluded.target_day, updated_at = now()
  returning id into goal_id;
  return goal_id;
end;
$$;

revoke all on function public.upsert_monthly_goal(uuid, bigint, smallint) from public;
grant execute on function public.upsert_monthly_goal(uuid, bigint, smallint) to authenticated;

create or replace function app_private.enqueue_new_expense_notification()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_name text;
  formatted_amount text;
begin
  if new.kind not in ('expense', 'card_purchase') or new.status <> 'posted' or new.deleted_at is not null then
    return new;
  end if;

  select display_name into actor_name from public.profiles where id = new.created_by;
  actor_name := coalesce(actor_name, 'Um membro');
  formatted_amount := replace(to_char(new.amount_cents / 100.0, 'FM999999990D00'), '.', ',');

  insert into public.notifications(household_id, user_id, kind, title, body)
  select
    new.household_id,
    member.user_id,
    'new_transaction',
    'Novo gasto de ' || actor_name,
    actor_name || ' adicionou R$ ' || formatted_amount || ' em ' || left(new.description, 180)
  from public.household_members member
  left join public.notification_preferences preference
    on preference.household_id = member.household_id and preference.user_id = member.user_id
  where member.household_id = new.household_id
    and member.status = 'active'
    and member.user_id <> new.created_by
    and coalesce(preference.new_transaction, true);
  return new;
end;
$$;

drop trigger if exists transactions_notify_household on public.transactions;
create trigger transactions_notify_household after insert on public.transactions
for each row execute function app_private.enqueue_new_expense_notification();

do $$
begin
  alter publication supabase_realtime add table public.monthly_goals;
exception when duplicate_object then null;
end $$;
