-- =====================================================================
-- Grand Vert Roulette – Supabase Setup
-- Im Supabase-Dashboard unter "SQL Editor" einmal komplett ausführen.
-- =====================================================================

-- 1) Profiltabelle: ein Spielstand pro Benutzerkonto -------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  balance     numeric(14,2) not null default 2000,
  stats       jsonb         not null default '{}'::jsonb,
  history     jsonb         not null default '[]'::jsonb,
  created_at  timestamptz   not null default now(),
  updated_at  timestamptz   not null default now(),
  -- Guthaben kann technisch nie negativ werden
  constraint balance_not_negative check (balance >= 0)
);

-- 2) Row Level Security: jeder sieht und ändert ausschließlich sein eigenes Profil
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles
  for delete using (auth.uid() = id);

-- 3) Beim Registrieren automatisch ein Profil mit 2.000 € Startguthaben anlegen
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, balance, stats, history)
  values (
    new.id,
    2000,
    '{"rounds":0,"wagered":0,"won":0,"lost":0,"biggestWin":0,"bestBalance":2000,"bailouts":0}'::jsonb,
    '[]'::jsonb
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4) Konto vollständig selbst löschen (DSGVO / Recht auf Löschung)
--    Löscht den Auth-Benutzer; das Profil verschwindet per ON DELETE CASCADE.
create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Nicht angemeldet';
  end if;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
