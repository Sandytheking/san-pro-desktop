-- SAN PRO PWA - Supabase schema
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.app_config (
  key text primary key,
  value jsonb not null,
  owner_id uuid references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  role text not null default 'owner' check (role in ('owner', 'admin', 'collector', 'viewer')),
  collector_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.collectors (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  loan_type text not null default 'san' check (loan_type in ('san', 'redito')),
  name text not null,
  phone text,
  document_id text,
  collector text not null,
  amount numeric(12,2) not null default 0,
  interest numeric(8,2) not null default 0,
  weeks integer not null default 13,
  contract_fee numeric(12,2) not null default 0,
  start_date date not null default current_date,
  total numeric(12,2) not null default 0,
  balance numeric(12,2) not null default 0,
  collected numeric(12,2) not null default 0,
  schedule jsonb not null default '[]'::jsonb,
  payments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  number text not null unique,
  client_id uuid not null references public.clients(id) on delete cascade,
  client_name text not null,
  amount numeric(12,2) not null,
  previous_balance numeric(12,2) not null,
  new_balance numeric(12,2) not null,
  payment_details jsonb not null default '{}'::jsonb,
  paid_at timestamptz not null default now()
);

create table if not exists public.licenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  installation_id text not null,
  license_key text,
  valid_until date not null,
  status text not null default 'trial' check (status in ('trial', 'active', 'expired')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migration-safe additions for projects that already ran an older SAN PRO schema.
-- `create table if not exists` does not add new columns to existing tables.
alter table public.app_config
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

alter table public.collectors
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

alter table public.clients
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

alter table public.clients
  add column if not exists loan_type text not null default 'san';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_loan_type_check'
  ) then
    alter table public.clients
      add constraint clients_loan_type_check check (loan_type in ('san', 'redito'));
  end if;
end;
$$;

alter table public.invoices
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

alter table public.invoices
  add column if not exists payment_details jsonb not null default '{}'::jsonb;

alter table public.licenses
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

-- Older versions created a global unique constraint on installation_id.
-- Multi-user mode needs the same browser/device installation to be reusable per account.
alter table public.licenses
  drop constraint if exists licenses_installation_id_key;

-- Multi-user friendly uniqueness. These are partial indexes so old shared rows
-- with owner_id null keep working while new user-owned rows are isolated.
create unique index if not exists collectors_owner_name_unique
  on public.collectors (owner_id, name)
  where owner_id is not null;

create unique index if not exists invoices_owner_number_unique
  on public.invoices (owner_id, number)
  where owner_id is not null;

create unique index if not exists licenses_owner_installation_unique
  on public.licenses (owner_id, installation_id)
  where owner_id is not null;

create unique index if not exists licenses_shared_installation_unique
  on public.licenses (installation_id)
  where owner_id is null;

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_touch_updated_at on public.clients;
create trigger clients_touch_updated_at
before update on public.clients
for each row execute function public.touch_updated_at();

drop trigger if exists config_touch_updated_at on public.app_config;
create trigger config_touch_updated_at
before update on public.app_config
for each row execute function public.touch_updated_at();

drop trigger if exists licenses_touch_updated_at on public.licenses;
create trigger licenses_touch_updated_at
before update on public.licenses
for each row execute function public.touch_updated_at();

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case
      when exists (select 1 from public.profiles) then 'viewer'
      else 'owner'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.can_manage_profiles()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role in ('owner', 'admin')
      and active = true
  );
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- This first version is designed for a private/internal app with the anon key.
-- Keep the Supabase project private and do not publish this URL/key publicly.
-- For multi-user production, enable Supabase Auth and replace these policies.
alter table public.app_config enable row level security;
alter table public.profiles enable row level security;
alter table public.collectors enable row level security;
alter table public.clients enable row level security;
alter table public.invoices enable row level security;
alter table public.licenses enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists "sanpro_app_config_all" on public.app_config;
create policy "sanpro_app_config_all" on public.app_config
for all using (owner_id is null or owner_id = auth.uid()) with check (owner_id is null or owner_id = auth.uid());

drop policy if exists "sanpro_profiles_read" on public.profiles;
create policy "sanpro_profiles_read" on public.profiles
for select using (id = auth.uid() or auth.uid() is not null);

drop policy if exists "sanpro_profiles_update_self" on public.profiles;

drop policy if exists "sanpro_profiles_manage" on public.profiles;
create policy "sanpro_profiles_manage" on public.profiles
for update using (public.can_manage_profiles()) with check (public.can_manage_profiles());

drop policy if exists "sanpro_collectors_all" on public.collectors;
create policy "sanpro_collectors_all" on public.collectors
for all using (owner_id is null or owner_id = auth.uid()) with check (owner_id is null or owner_id = auth.uid());

drop policy if exists "sanpro_clients_all" on public.clients;
create policy "sanpro_clients_all" on public.clients
for all using (owner_id is null or owner_id = auth.uid()) with check (owner_id is null or owner_id = auth.uid());

drop policy if exists "sanpro_invoices_all" on public.invoices;
create policy "sanpro_invoices_all" on public.invoices
for all using (owner_id is null or owner_id = auth.uid()) with check (owner_id is null or owner_id = auth.uid());

drop policy if exists "sanpro_licenses_all" on public.licenses;
create policy "sanpro_licenses_all" on public.licenses
for all using (owner_id is null or owner_id = auth.uid()) with check (owner_id is null or owner_id = auth.uid());

drop policy if exists "sanpro_audit_all" on public.audit_log;
create policy "sanpro_audit_all" on public.audit_log
for all using (owner_id is null or owner_id = auth.uid()) with check (owner_id is null or owner_id = auth.uid());
