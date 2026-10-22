-- Семейный бюджет: схема базы Supabase.
-- Выполните целиком в Supabase: SQL Editor -> New query -> вставить -> Run.

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  invite_code text unique not null default substr(md5(random()::text || clock_timestamp()::text), 1, 8),
  settings jsonb not null default '{"currency":"₽","limits":{}}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists members (
  user_id uuid primary key references auth.users on delete cascade,
  household_id uuid not null references households on delete cascade,
  display_name text not null default ''
);

create table if not exists accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  type text not null check (type in ('cash','debit','savings','credit','loan')),
  initial numeric not null default 0,
  credit_limit numeric,
  rate numeric,
  payment numeric,
  created_at timestamptz not null default now()
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  kind text not null check (kind in ('expense','income','transfer')),
  amount numeric not null check (amount > 0),
  date date not null,
  cat text,
  acc_id uuid not null references accounts on delete restrict,
  to_id uuid references accounts on delete restrict,
  note text not null default '',
  by_user uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists tx_household_date on transactions (household_id, date desc);
create index if not exists acc_household on accounts (household_id);

-- Семья текущего пользователя
create or replace function my_household() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from members where user_id = auth.uid()
$$;

alter table households   enable row level security;
alter table members      enable row level security;
alter table accounts     enable row level security;
alter table transactions enable row level security;

drop policy if exists hh_select on households;
drop policy if exists hh_update on households;
drop policy if exists mem_select on members;
drop policy if exists mem_update on members;
drop policy if exists acc_all on accounts;
drop policy if exists tx_all on transactions;

create policy hh_select on households for select to authenticated using (id = my_household());
create policy hh_update on households for update to authenticated using (id = my_household()) with check (id = my_household());
create policy mem_select on members for select to authenticated using (household_id = my_household());
create policy mem_update on members for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and household_id = my_household());
create policy acc_all on accounts for all to authenticated using (household_id = my_household()) with check (household_id = my_household());
create policy tx_all on transactions for all to authenticated using (household_id = my_household()) with check (household_id = my_household());

-- Создать семью
create or replace function create_household(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'already_member'; end if;
  insert into households default values returning id into hid;
  insert into members (user_id, household_id, display_name) values (auth.uid(), hid, left(trim(p_name), 30));
  return hid;
end $$;

-- Присоединиться по коду (до 6 участников)
create or replace function join_household(p_code text, p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from members where user_id = auth.uid()) then raise exception 'already_member'; end if;
  select id into hid from households where invite_code = lower(trim(p_code));
  if hid is null then raise exception 'code_not_found'; end if;
  if (select count(*) from members where household_id = hid) >= 6 then raise exception 'family_full'; end if;
  insert into members (user_id, household_id, display_name) values (auth.uid(), hid, left(trim(p_name), 30));
  return hid;
end $$;

revoke all on function create_household(text) from public, anon;
revoke all on function join_household(text, text) from public, anon;
grant execute on function create_household(text) to authenticated;
grant execute on function join_household(text, text) to authenticated;

-- Мгновенная синхронизация между телефонами
alter publication supabase_realtime add table accounts, transactions, households, members;
