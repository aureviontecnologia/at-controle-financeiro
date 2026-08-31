-- Histórico do assistente compartilhado por household.

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  title text not null default 'Novo chat' check (char_length(title) between 1 and 80),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) between 1 and 4000),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists ai_conversations_household_updated_idx on public.ai_conversations(household_id, updated_at desc) where deleted_at is null;
create index if not exists ai_messages_conversation_created_idx on public.ai_messages(conversation_id, created_at);

drop trigger if exists ai_conversations_updated on public.ai_conversations;
create trigger ai_conversations_updated before update on public.ai_conversations for each row execute function public.set_updated_at();

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

drop policy if exists ai_conversations_member_read on public.ai_conversations;
create policy ai_conversations_member_read on public.ai_conversations for select to authenticated using (deleted_at is null and app_private.is_household_member(household_id));
drop policy if exists ai_conversations_member_insert on public.ai_conversations;
create policy ai_conversations_member_insert on public.ai_conversations for insert to authenticated with check (created_by = auth.uid() and app_private.is_household_member(household_id));
drop policy if exists ai_messages_member_read on public.ai_messages;
create policy ai_messages_member_read on public.ai_messages for select to authenticated using (
  app_private.is_household_member(household_id)
  and exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.household_id = ai_messages.household_id and c.deleted_at is null)
);

revoke insert, update, delete on public.ai_messages from authenticated;
revoke update, delete on public.ai_conversations from authenticated;
grant select, insert on public.ai_conversations to authenticated;
grant select on public.ai_messages to authenticated;

create or replace function public.archive_ai_conversation(target_household uuid, target_conversation uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform app_private.assert_household_member(target_household);
  update public.ai_conversations
  set deleted_at = now(), updated_at = now()
  where id = target_conversation and household_id = target_household and deleted_at is null;
  if not found then raise exception 'conversation_not_found' using errcode = '22023'; end if;
end;
$$;

revoke all on function public.archive_ai_conversation(uuid, uuid) from public;
grant execute on function public.archive_ai_conversation(uuid, uuid) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.ai_conversations;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.ai_messages;
exception when duplicate_object then null;
end $$;
