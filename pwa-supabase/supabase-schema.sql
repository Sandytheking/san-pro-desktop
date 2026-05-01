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
  business_owner_id uuid references auth.users(id) on delete cascade,
  invite_code text unique,
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

alter table public.profiles
  add column if not exists business_owner_id uuid references auth.users(id) on delete cascade;

alter table public.profiles
  add column if not exists invite_code text;

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

alter table public.invoices
  add column if not exists payment_id uuid;

alter table public.licenses
  add column if not exists owner_id uuid references auth.users(id) on delete cascade;

-- Older versions created a global unique constraint on installation_id.
-- Multi-user mode needs the same browser/device installation to be reusable per account.
alter table public.licenses
  drop constraint if exists licenses_installation_id_key;

alter table public.collectors
  drop constraint if exists collectors_name_key;

alter table public.invoices
  drop constraint if exists invoices_number_key;

create unique index if not exists profiles_invite_code_unique
  on public.profiles (invite_code)
  where invite_code is not null;

-- Multi-tenant uniqueness. Every business is isolated by owner_id.
create unique index if not exists collectors_owner_name_unique
  on public.collectors (owner_id, name)
  where owner_id is not null;

create unique index if not exists invoices_owner_number_unique
  on public.invoices (owner_id, number)
  where owner_id is not null;

alter table public.clients
  add column if not exists collector_id uuid references public.collectors(id) on delete set null;

alter table public.profiles
  add column if not exists collector_id uuid references public.collectors(id) on delete set null;

create table if not exists public.invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'collector' check (role in ('admin', 'collector', 'viewer')),
  status text not null default 'pending' check (status in ('pending', 'used', 'expired')),
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now()
);

-- update collector_id based on collector name if missing
update public.clients c
set collector_id = (select id from public.collectors col where col.name = c.collector and col.owner_id = c.owner_id limit 1)
where c.collector_id is null;

update public.profiles p
set collector_id = (select id from public.collectors col where col.name = p.collector_name and col.owner_id = p.business_owner_id limit 1)
where p.collector_id is null and p.collector_name is not null;


create unique index if not exists invoices_owner_payment_unique
  on public.invoices (owner_id, payment_id)
  where owner_id is not null and payment_id is not null;

create unique index if not exists licenses_owner_installation_unique
  on public.licenses (owner_id, installation_id)
  where owner_id is not null;

create unique index if not exists licenses_shared_installation_unique
  on public.licenses (installation_id)
  where owner_id is null;

update public.profiles
set business_owner_id = id
where business_owner_id is null;

update public.profiles
set invite_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
where invite_code is null
  and role in ('owner', 'admin');

update public.collectors
set owner_id = (select id from public.profiles where role = 'owner' order by created_at asc limit 1)
where owner_id is null;

update public.clients
set owner_id = (select id from public.profiles where role = 'owner' order by created_at asc limit 1)
where owner_id is null;

update public.invoices
set owner_id = (select id from public.profiles where role = 'owner' order by created_at asc limit 1)
where owner_id is null;

update public.licenses l
set owner_id = (select id from public.profiles where role = 'owner' order by created_at asc limit 1)
where l.owner_id is null
  and not exists (
    select 1
    from public.licenses existing
    where existing.owner_id = (select id from public.profiles where role = 'owner' order by created_at asc limit 1)
      and existing.installation_id = l.installation_id
  );

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

create or replace function public.register_payment(
  p_client_id uuid,
  p_amount numeric,
  p_invoice_number text,
  p_payment_details jsonb,
  p_new_balance numeric,
  p_new_collected numeric,
  p_new_total numeric,
  p_new_schedule jsonb,
  p_new_payments jsonb,
  p_queued_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_invoice public.invoices%rowtype;
  v_owner_id uuid;
begin
  select * into v_client from public.clients where id = p_client_id for update;
  if not found then raise exception 'Cliente no encontrado'; end if;
  v_owner_id := v_client.owner_id;

  if not public.can_write_business() or not public.same_business(v_owner_id) then
    raise exception 'Permisos insuficientes';
  end if;

  if p_amount > v_client.balance then
    raise exception 'El monto no puede ser mayor al balance pendiente';
  end if;

  update public.clients
  set balance = p_new_balance, collected = p_new_collected, total = p_new_total, schedule = p_new_schedule, payments = p_new_payments
  where id = p_client_id;

  insert into public.invoices (owner_id, number, client_id, client_name, amount, previous_balance, new_balance, payment_details, paid_at)
  values (v_owner_id, p_invoice_number, p_client_id, v_client.name, p_amount, v_client.balance, p_new_balance, p_payment_details, p_queued_at)
  returning * into v_invoice;

  return row_to_json(v_invoice)::jsonb;
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
declare
  matched_business_owner uuid;
  requested_code text;
begin
  requested_code := nullif(upper(trim(coalesce(new.raw_user_meta_data->>'business_code', ''))), '');

  if requested_code is not null then
    select coalesce(business_owner_id, id)
      into matched_business_owner
    from public.profiles
    where invite_code = requested_code
    limit 1;
  end if;

  insert into public.profiles (id, full_name, role, business_owner_id, invite_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    case when matched_business_owner is null then 'owner' else 'viewer' end,
    coalesce(matched_business_owner, new.id),
    case
      when matched_business_owner is null then upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
      else null
    end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.current_business_owner_id()
returns uuid
language sql
security definer
set search_path = public
as $$
  select business_owner_id
  from public.profiles
  where id = auth.uid()
    and active = true
  limit 1;
$$;

create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid()
    and active = true
  limit 1;
$$;

create or replace function public.current_collector_name()
returns text
language sql
security definer
set search_path = public
as $$
  select collector_name
  from public.profiles
  where id = auth.uid()
    and active = true
  limit 1;
$$;

create or replace function public.same_business(target_owner uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select target_owner is not null
    and target_owner = public.current_business_owner_id();
$$;

create or replace function public.current_collector_id()
returns uuid
language sql
security definer
set search_path = public
as $$
  select collector_id
  from public.profiles
  where id = auth.uid()
    and active = true
  limit 1;
$$;

create or replace function public.can_access_client(target_owner uuid, target_collector_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.same_business(target_owner)
    and (
      public.current_user_role() in ('owner', 'admin', 'viewer')
      or (
        public.current_user_role() = 'collector'
        and (target_collector_id = public.current_collector_id() or target_collector_id is null)
      )
    );
$$;

create or replace function public.can_manage_business()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.current_user_role() in ('owner', 'admin');
$$;

create or replace function public.can_write_business()
returns boolean
language sql
security definer
set search_path = public
as $$
  select public.current_user_role() in ('owner', 'admin', 'collector');
$$;

create or replace function public.register_payment(
  p_client_id uuid,
  p_payment_id uuid,
  p_invoice_number text,
  p_amount numeric,
  p_new_balance numeric,
  p_new_total numeric,
  p_schedule jsonb,
  p_payments jsonb,
  p_payment_details jsonb default '{}'::jsonb,
  p_paid_at timestamptz default now(),
  p_expected_updated_at timestamptz default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  locked_client public.clients%rowtype;
  created_invoice public.invoices%rowtype;
begin
  if p_amount <= 0 then
    raise exception 'payment_amount_invalid';
  end if;

  select *
    into locked_client
  from public.clients
  where id = p_client_id
  for update;

  if not found then
    raise exception 'client_not_found';
  end if;

  if not public.can_access_client(locked_client.owner_id, locked_client.collector) then
    raise exception 'client_not_accessible';
  end if;

  select *
    into created_invoice
  from public.invoices
  where owner_id = locked_client.owner_id
    and payment_id = p_payment_id
  limit 1;

  if found then
    return created_invoice;
  end if;

  if p_expected_updated_at is not null and locked_client.updated_at <> p_expected_updated_at then
    raise exception 'client_changed_reload_before_payment';
  end if;

  update public.clients
  set balance = p_new_balance,
      collected = locked_client.collected + p_amount,
      total = p_new_total,
      schedule = p_schedule,
      payments = p_payments
  where id = locked_client.id;

  insert into public.invoices (
    owner_id,
    payment_id,
    number,
    client_id,
    client_name,
    amount,
    previous_balance,
    new_balance,
    payment_details,
    paid_at
  ) values (
    locked_client.owner_id,
    p_payment_id,
    p_invoice_number,
    locked_client.id,
    locked_client.name,
    p_amount,
    locked_client.balance,
    p_new_balance,
    coalesce(p_payment_details, '{}'::jsonb),
    coalesce(p_paid_at, now())
  )
  returning * into created_invoice;

  return created_invoice;
end;
$$;

grant execute on function public.register_payment(
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  numeric,
  jsonb,
  jsonb,
  jsonb,
  timestamptz,
  timestamptz
) to authenticated;

create or replace function public.ensure_profile_business_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.business_owner_id is null then
    new.business_owner_id := new.id;
  end if;
  if new.invite_code is null and new.role in ('owner', 'admin') then
    new.invite_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_ensure_business_owner on public.profiles;
create trigger profiles_ensure_business_owner
before insert on public.profiles
for each row execute function public.ensure_profile_business_owner();

create or replace function public.ensure_tenant_owner_id()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is null then
    new.owner_id := public.current_business_owner_id();
  end if;
  return new;
end;
$$;

drop trigger if exists collectors_ensure_tenant on public.collectors;
create trigger collectors_ensure_tenant
before insert on public.collectors
for each row execute function public.ensure_tenant_owner_id();

drop trigger if exists clients_ensure_tenant on public.clients;
create trigger clients_ensure_tenant
before insert on public.clients
for each row execute function public.ensure_tenant_owner_id();

drop trigger if exists invoices_ensure_tenant on public.invoices;
create trigger invoices_ensure_tenant
before insert on public.invoices
for each row execute function public.ensure_tenant_owner_id();

drop trigger if exists licenses_ensure_tenant on public.licenses;
create trigger licenses_ensure_tenant
before insert on public.licenses
for each row execute function public.ensure_tenant_owner_id();

drop trigger if exists audit_ensure_tenant on public.audit_log;
create trigger audit_ensure_tenant
before insert on public.audit_log
for each row execute function public.ensure_tenant_owner_id();

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
      and business_owner_id = public.current_business_owner_id()
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
drop policy if exists "sanpro_app_config_select" on public.app_config;
drop policy if exists "sanpro_app_config_write" on public.app_config;
create policy "sanpro_app_config_select" on public.app_config
for select using (public.same_business(owner_id));
create policy "sanpro_app_config_write" on public.app_config
for all using (public.can_manage_business() and public.same_business(owner_id))
with check (public.can_manage_business() and public.same_business(owner_id));

drop policy if exists "sanpro_profiles_read" on public.profiles;
drop policy if exists "sanpro_profiles_insert_self" on public.profiles;
drop policy if exists "sanpro_profiles_update_self" on public.profiles;
drop policy if exists "sanpro_profiles_manage" on public.profiles;
create policy "sanpro_profiles_read" on public.profiles
for select using (id = auth.uid() or business_owner_id = public.current_business_owner_id());
create policy "sanpro_profiles_insert_self" on public.profiles
for insert with check (id = auth.uid() and business_owner_id = auth.uid());
create policy "sanpro_profiles_manage" on public.profiles
for update using (
  public.can_manage_profiles() 
  and business_owner_id = public.current_business_owner_id()
  and (
    -- Only owners can modify owners
    (role = 'owner' and public.current_user_role() = 'owner')
    or (role != 'owner')
  )
)
with check (
  public.can_manage_profiles() 
  and business_owner_id = public.current_business_owner_id()
);

drop policy if exists "sanpro_collectors_all" on public.collectors;
drop policy if exists "sanpro_collectors_select" on public.collectors;
drop policy if exists "sanpro_collectors_manage" on public.collectors;
create policy "sanpro_collectors_select" on public.collectors
for select using (
  public.same_business(owner_id)
  and (
    public.current_user_role() in ('owner', 'admin', 'viewer')
    or (public.current_user_role() = 'collector' and name = public.current_collector_name())
  )
);
create policy "sanpro_collectors_manage" on public.collectors
for all using (public.can_manage_business() and public.same_business(owner_id))
with check (public.can_manage_business() and public.same_business(owner_id));

drop policy if exists "sanpro_clients_all" on public.clients;
drop policy if exists "sanpro_clients_select" on public.clients;
drop policy if exists "sanpro_clients_insert" on public.clients;
drop policy if exists "sanpro_clients_update" on public.clients;
drop policy if exists "sanpro_clients_delete" on public.clients;
create policy "sanpro_clients_select" on public.clients
for select using (public.can_access_client(owner_id, collector_id));
create policy "sanpro_clients_insert" on public.clients
for insert with check (
  public.same_business(owner_id)
  and (
    public.can_manage_business()
    or public.current_user_role() = 'collector'
  )
);
create policy "sanpro_clients_update" on public.clients
for update using (public.can_access_client(owner_id, collector_id))
with check (public.can_access_client(owner_id, collector_id));
create policy "sanpro_clients_delete" on public.clients
for delete using (public.can_manage_business() and public.same_business(owner_id));

drop policy if exists "sanpro_invoices_all" on public.invoices;
drop policy if exists "sanpro_invoices_select" on public.invoices;
drop policy if exists "sanpro_invoices_insert" on public.invoices;
create policy "sanpro_invoices_select" on public.invoices
for select using (
  public.same_business(owner_id)
  and exists (
    select 1 from public.clients c
    where c.id = client_id
      and public.can_access_client(c.owner_id, c.collector_id)
  )
);
create policy "sanpro_invoices_insert" on public.invoices
for insert with check (
  public.can_write_business()
  and public.same_business(owner_id)
  and exists (
    select 1 from public.clients c
    where c.id = client_id
      and public.can_access_client(c.owner_id, c.collector_id)
  )
);

drop policy if exists "sanpro_licenses_all" on public.licenses;
drop policy if exists "sanpro_licenses_select" on public.licenses;
drop policy if exists "sanpro_licenses_write" on public.licenses;
create policy "sanpro_licenses_select" on public.licenses
for select using (public.same_business(owner_id));
create policy "sanpro_licenses_write" on public.licenses
for all using (public.current_user_role() = 'owner' and public.same_business(owner_id))
with check (public.current_user_role() = 'owner' and public.same_business(owner_id));

drop policy if exists "sanpro_audit_all" on public.audit_log;
drop policy if exists "sanpro_audit_select" on public.audit_log;
drop policy if exists "sanpro_audit_insert" on public.audit_log;
create policy "sanpro_audit_select" on public.audit_log
for select using (public.same_business(owner_id));
create policy "sanpro_audit_insert" on public.audit_log
for insert with check (public.same_business(owner_id));
