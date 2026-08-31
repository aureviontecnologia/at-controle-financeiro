-- Correções da versão 1.0.1: vínculo automático restrito ao casal, presença e detalhes de pagamento.

alter table public.profiles add column if not exists last_seen_at timestamptz;
alter table public.transactions add column if not exists payment_method_detail text;
alter table public.transactions add column if not exists installment_count smallint not null default 1;

alter table public.transactions drop constraint if exists transactions_payment_method_detail_check;
alter table public.transactions add constraint transactions_payment_method_detail_check check (payment_method_detail is null or char_length(payment_method_detail) between 2 and 40);
alter table public.transactions drop constraint if exists transactions_installment_count_check;
alter table public.transactions add constraint transactions_installment_count_check check (installment_count between 1 and 36);

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
  a.opening_balance_cents + coalesce(sum(le.amount_cents) filter (where t.status = 'posted' and t.deleted_at is null), 0)::bigint as balance_cents
from public.accounts a
left join public.ledger_entries le on le.account_id = a.id
left join public.transactions t on t.id = le.transaction_id
where a.archived_at is null and a.is_active
group by a.id;

grant select on public.account_balances to authenticated;

create or replace function public.bootstrap_at_household()
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
declare
  current_user uuid := auth.uid();
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  current_email_hash text := encode(digest(current_email, 'sha256'), 'hex');
  display_name text;
  target_household uuid;
begin
  if current_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if current_email_hash not in ('691f3c3d5867790e84471327fa3f2de4fd228136cca910bad248bed14a83f931', '3893eea5e5cd3daf3206a0869e206502c300b5b0de9abbfece7a90bc1cae30d7') then
    raise exception 'account_not_allowed_for_at_household' using errcode = '42501';
  end if;
  display_name := case when current_email_hash = '3893eea5e5cd3daf3206a0869e206502c300b5b0de9abbfece7a90bc1cae30d7' then 'Thauane' else 'Alberto' end;
  perform pg_advisory_xact_lock(hashtextextended('at-household-bootstrap', 0));

  insert into public.profiles(id, display_name, last_seen_at)
  values (current_user, display_name, now())
  on conflict (id) do update set display_name = excluded.display_name, last_seen_at = now();

  select h.id into target_household
  from public.households h
  join public.household_members hm on hm.household_id = h.id and hm.status = 'active'
  join auth.users au on au.id = hm.user_id
  where encode(digest(lower(coalesce(au.email, '')), 'sha256'), 'hex') in ('691f3c3d5867790e84471327fa3f2de4fd228136cca910bad248bed14a83f931', '3893eea5e5cd3daf3206a0869e206502c300b5b0de9abbfece7a90bc1cae30d7') and h.deleted_at is null
  order by h.created_at
  limit 1;

  if target_household is null then
    insert into public.households(name, created_by) values ('A&T', current_user) returning id into target_household;
    insert into public.household_members(household_id, user_id, role, status) values (target_household, current_user, 'owner', 'active');
  else
    insert into public.household_members(household_id, user_id, role, status)
    values (target_household, current_user, 'member', 'active')
    on conflict (household_id, user_id) do update set status = 'active';
  end if;

  insert into public.notification_preferences(household_id, user_id) values (target_household, current_user) on conflict do nothing;
  insert into public.categories(household_id, name, created_by)
  select target_household, category_name, current_user
  from unnest(array['Alimentação','Mercado','Casa','Transporte','Lazer','Saúde','Compras','Outros']) as category_name
  on conflict (household_id, name) do nothing;
  return target_household;
end;
$$;

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
declare transaction_record record;
begin
  select household_id, created_by, kind into transaction_record from public.transactions where id = target_transaction and deleted_at is null;
  if not found then raise exception 'transaction_not_found' using errcode = '22023'; end if;
  perform app_private.assert_household_member(transaction_record.household_id);
  if transaction_record.created_by <> auth.uid() then raise exception 'transaction_owner_required' using errcode = '42501'; end if;
  if installments not between 1 and 36 then raise exception 'invalid_installment_count' using errcode = '22023'; end if;
  if installments > 1 and transaction_record.kind <> 'card_purchase' then raise exception 'installments_require_card_purchase' using errcode = '22023'; end if;
  update public.transactions
  set payment_method_detail = nullif(trim(method_detail), ''), installment_count = installments, updated_at = now()
  where id = target_transaction;
end;
$$;

revoke all on function public.bootstrap_at_household() from public;
revoke all on function public.set_transaction_payment_details(uuid, text, smallint) from public;
grant execute on function public.bootstrap_at_household() to authenticated;
grant execute on function public.set_transaction_payment_details(uuid, text, smallint) to authenticated;
