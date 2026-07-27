-- AUTH-002/AUTH-003: Safe profile bootstrap and self-service onboarding.

alter table public.profiles
  add column onboarding_completed_at timestamp with time zone;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  safe_display_name text;
begin
  safe_display_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'New user'
  );

  insert into public.profiles (id, role, display_name)
  values (new.id, 'researcher', left(safe_display_name, 120))
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger auth_user_profile_bootstrap
after insert on auth.users
for each row
execute function public.handle_new_auth_user();

create or replace function public.complete_profile_onboarding(
  selected_role text,
  selected_display_name text
)
returns public.profiles
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_user_id uuid := auth.uid();
  existing_profile public.profiles;
  updated_profile public.profiles;
begin
  if current_user_id is null then
    raise exception 'Authentication is required' using errcode = '28000';
  end if;

  if selected_role not in ('owner', 'researcher') then
    raise exception 'Role is not self-assignable' using errcode = '42501';
  end if;

  if length(btrim(selected_display_name)) not between 1 and 120 then
    raise exception 'Display name is invalid' using errcode = '22023';
  end if;

  select *
  into existing_profile
  from public.profiles
  where id = current_user_id
  for update;

  if not found then
    raise exception 'Profile does not exist' using errcode = 'P0002';
  end if;

  if existing_profile.onboarding_completed_at is not null then
    if existing_profile.role = selected_role
      and existing_profile.display_name = btrim(selected_display_name)
    then
      return existing_profile;
    end if;

    raise exception 'Onboarding is already complete' using errcode = '23505';
  end if;

  update public.profiles
  set
    role = selected_role,
    display_name = btrim(selected_display_name),
    onboarding_completed_at = now()
  where id = current_user_id
  returning * into updated_profile;

  insert into public.audit_logs (
    actor_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    metadata
  )
  values (
    current_user_id,
    'user',
    'profile.onboarding_completed',
    'profile',
    current_user_id::text,
    jsonb_build_object('role', selected_role)
  );

  return updated_profile;
end;
$$;

revoke all on function public.complete_profile_onboarding(text, text) from public;
grant execute on function public.complete_profile_onboarding(text, text) to authenticated;
