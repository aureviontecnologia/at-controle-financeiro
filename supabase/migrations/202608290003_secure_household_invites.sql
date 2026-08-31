-- Convites não dependem de IDs fixos nem expõem a lista de usuários do Auth.
create table public.household_invites (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  token_hash bytea not null unique,
  created_by uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  accepted_by uuid references public.profiles(id),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((accepted_by is null and accepted_at is null) or (accepted_by is not null and accepted_at is not null))
);

create index household_invites_active_idx on public.household_invites(household_id, expires_at) where accepted_at is null and revoked_at is null;
alter table public.household_invites enable row level security;

create policy invites_owner_read on public.household_invites for select to authenticated using (app_private.is_household_owner(household_id));
create policy invites_owner_revoke on public.household_invites for update to authenticated using (app_private.is_household_owner(household_id)) with check (app_private.is_household_owner(household_id));

create or replace function public.create_household_invite(target_household uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare raw_token uuid := gen_random_uuid();
begin
  if not app_private.is_household_owner(target_household) then raise exception 'owner_access_required' using errcode = '42501'; end if;
  if (select count(*) from public.household_members where household_id = target_household and status = 'active') >= 10 then raise exception 'household_member_limit' using errcode = '22023'; end if;
  update public.household_invites set revoked_at = now() where household_id = target_household and accepted_at is null and revoked_at is null;
  insert into public.household_invites(household_id, token_hash, created_by, expires_at)
  values (target_household, digest(raw_token::text, 'sha256'), auth.uid(), now() + interval '24 hours');
  return raw_token;
end;
$$;

create or replace function public.accept_household_invite(raw_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare invite_record record;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into invite_record from public.household_invites
  where token_hash = digest(raw_token::text, 'sha256') and accepted_at is null and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception 'invite_invalid_or_expired' using errcode = '22023'; end if;
  insert into public.household_members(household_id, user_id, role, status, invited_by)
  values (invite_record.household_id, auth.uid(), 'member', 'active', invite_record.created_by)
  on conflict (household_id, user_id) do update set status = 'active';
  insert into public.notification_preferences(household_id, user_id) values (invite_record.household_id, auth.uid()) on conflict do nothing;
  update public.household_invites set accepted_by = auth.uid(), accepted_at = now() where id = invite_record.id;
  return invite_record.household_id;
end;
$$;

revoke all on function public.create_household_invite(uuid) from public;
revoke all on function public.accept_household_invite(uuid) from public;
grant execute on function public.create_household_invite(uuid) to authenticated;
grant execute on function public.accept_household_invite(uuid) to authenticated;
revoke all on all functions in schema app_private from public;
