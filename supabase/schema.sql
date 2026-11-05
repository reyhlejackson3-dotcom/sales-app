-- Convertd database. Run this once in Supabase: SQL Editor > New query > paste > Run.
-- Only the server (with the secret key) reads or writes these tables. Row Level Security is on with no policies,
-- so the public key in the browser cannot touch them.

create table if not exists public.accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  plan text not null default 'trial' check (plan in ('trial', 'starter', 'pro', 'elite')),
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  sub_status text,                       -- Stripe status: active, trialing, past_due, canceled, ...
  cancel_at_period_end boolean not null default false,
  period_end timestamptz,                -- when the current paid month ends
  number text,                           -- the user's calling number, +1XXXXXXXXXX
  number_sid text,                       -- Twilio id of that number (PN...)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per thing used: a lead (place id), a prep (website), a practice call, an answered call (Twilio call id).
-- Counting rows per period gives usage, and the same key never counts twice.
create table if not exists public.usage_keys (
  user_id uuid not null references public.accounts (id) on delete cascade,
  period text not null,                  -- 'lifetime' on the free trial, otherwise 'YYYY-MM'
  kind text not null check (kind in ('dials', 'calls', 'preps', 'leads')),
  key text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, period, kind, key)
);

alter table public.accounts enable row level security;
alter table public.usage_keys enable row level security;

-- Adds keys up to the plan limit, atomically. Returns the keys that are allowed (already counted ones included).
create or replace function public.use_keys(p_user uuid, p_period text, p_kind text, p_keys text[], p_limit int)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
  n int;
  allowed text[] := '{}';
begin
  perform pg_advisory_xact_lock(hashtext(p_user::text || ':' || p_kind));
  select count(*) into n from usage_keys where user_id = p_user and period = p_period and kind = p_kind;
  foreach k in array coalesce(p_keys, '{}') loop
    if exists (select 1 from usage_keys where user_id = p_user and period = p_period and kind = p_kind and key = k) then
      allowed := allowed || k;
    elsif n < p_limit then
      insert into usage_keys (user_id, period, kind, key) values (p_user, p_period, p_kind, k);
      n := n + 1;
      allowed := allowed || k;
    end if;
  end loop;
  return allowed;
end;
$$;

-- Usage per kind for one period.
create or replace function public.usage_counts(p_user uuid, p_period text)
returns table (kind text, n int)
language sql
security definer
set search_path = public
as $$
  select kind, count(*)::int from usage_keys where user_id = p_user and period = p_period group by kind;
$$;

revoke all on function public.use_keys(uuid, text, text, text[], int) from public, anon, authenticated;
revoke all on function public.usage_counts(uuid, text) from public, anon, authenticated;
grant execute on function public.usage_counts(uuid, text) to service_role;
grant execute on function public.use_keys(uuid, text, text, text[], int) to service_role;
