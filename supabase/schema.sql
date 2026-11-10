-- Insert Note: database setup for Supabase.
-- Paste this whole file into Supabase > SQL Editor > New query, and press Run. Safe to run more than once.

-- ---------- members ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  status text not null default 'pending' check (status in ('pending','approved','blocked')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Every new sign-up starts as a pending application.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, left(coalesce(new.raw_user_meta_data->>'display_name', ''), 20))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_admin);
$$;
create or replace function public.is_approved() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and status = 'approved');
$$;

-- ---------- notes ----------
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  slot text not null check (slot ~ '^(A[1-6]|[B-F][1-4])$'),
  activity text not null check (char_length(activity) between 3 and 48),
  color text not null check (color in ('green','pink','blue','yellow','violet')),
  author uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  pulled_by uuid references public.profiles(id) on delete set null,
  pulled_at timestamptz
);
-- One note per box while it is in the machine.
create unique index if not exists notes_one_per_slot on public.notes (slot) where pulled_by is null and pulled_at is null;

-- Name and contact live apart from the note, so they stay hidden until the note is pulled.
create table if not exists public.note_secrets (
  note_id uuid primary key references public.notes(id) on delete cascade,
  name text not null,
  contact text not null
);

-- ---------- who can see and change what ----------
alter table public.profiles enable row level security;
alter table public.notes enable row level security;
alter table public.note_secrets enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists notes_read on public.notes;
create policy notes_read on public.notes for select to authenticated
  using (public.is_approved() or public.is_admin());
drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes for delete to authenticated
  using (author = auth.uid() or public.is_admin());

drop policy if exists secrets_read on public.note_secrets;
create policy secrets_read on public.note_secrets for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.notes n
    where n.id = note_id and (n.author = auth.uid() or n.pulled_by = auth.uid())));

-- Notes are only added and pulled through these two functions.
create or replace function public.leave_note(p_slot text, p_activity text, p_color text, p_name text, p_contact text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_approved() then raise exception 'not_approved'; end if;
  if char_length(trim(p_name)) < 1 or char_length(trim(p_contact)) < 3 then raise exception 'missing_details'; end if;
  if (select count(*) from public.notes where author = auth.uid() and pulled_by is null) >= 3 then
    raise exception 'limit';
  end if;
  begin
    insert into public.notes (slot, activity, color, author)
    values (p_slot, left(trim(p_activity), 48), p_color, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'slot_taken';
  end;
  insert into public.note_secrets (note_id, name, contact)
  values (v_id, left(trim(p_name), 20), left(trim(p_contact), 32));
  return v_id;
end $$;

create or replace function public.pull_note(p_note uuid)
returns table (name text, contact text) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_approved() then raise exception 'not_approved'; end if;
  update public.notes n set pulled_by = auth.uid(), pulled_at = now()
  where n.id = p_note and n.pulled_by is null and n.pulled_at is null and n.author <> auth.uid();
  if not found then return; end if;                      -- already pulled, or your own note
  return query select s.name, s.contact from public.note_secrets s where s.note_id = p_note;
end $$;

revoke all on function public.leave_note(text,text,text,text,text) from public, anon;
revoke all on function public.pull_note(uuid) from public, anon;
grant execute on function public.leave_note(text,text,text,text,text) to authenticated;
grant execute on function public.pull_note(uuid) to authenticated;
revoke insert, update on public.notes from anon, authenticated;
revoke insert, update, delete on public.note_secrets from anon, authenticated;
revoke insert, delete on public.profiles from anon, authenticated;

-- Live updates when notes are added or pulled.
do $$ begin
  alter publication supabase_realtime add table public.notes;
exception when duplicate_object then null; end $$;

-- ---------- make yourself the admin ----------
-- 1. Sign up on your site with your own email first.
-- 2. Then run this one line here, with your email in place of the example:
--
--    update public.profiles set is_admin = true, status = 'approved' where email = 'you@example.com';
