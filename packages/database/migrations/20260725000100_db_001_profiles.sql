-- DB-001: Application profiles backed by Supabase Auth users.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid
    constraint profiles_pkey primary key
    constraint profiles_user_id_fkey references auth.users (id) on delete cascade,
  role text not null default 'researcher'
    constraint profiles_role_check check (role in ('owner', 'researcher', 'reviewer')),
  display_name text not null
    constraint profiles_display_name_not_blank_check check (length(btrim(display_name)) > 0),
  wallet_address text
    constraint profiles_wallet_address_format_check
      check (wallet_address is null or wallet_address ~ '^0x[0-9a-fA-F]{40}$'),
  avatar_url text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

comment on column public.profiles.role is
  'Defaults to researcher so profile creation cannot grant owner or reviewer privileges.';

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;
