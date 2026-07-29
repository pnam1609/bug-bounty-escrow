-- SEC-PROD-001: make an Auth ban effective at the database boundary immediately.
--
-- Supabase Auth rejects a banned user at its own HTTP endpoints, but an access JWT already issued
-- before the ban remains cryptographically valid until its expiry. PostgREST and Storage authorize
-- that JWT directly as the `authenticated` database role, so Auth's HTTP check is not involved.
-- These RESTRICTIVE policies add the missing database-side check without changing any existing
-- permissive ownership/participant policy.

create or replace function public.is_active_auth_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = auth.uid()
      and (
        auth_user.banned_until is null
        or auth_user.banned_until <= pg_catalog.statement_timestamp()
      )
  )
$$;

revoke all on function public.is_active_auth_user() from public, anon;
grant execute on function public.is_active_auth_user() to authenticated;

-- The read helpers below must remain executable by `authenticated` because the existing RLS and
-- Storage policies call them. They are SECURITY DEFINER, however, so a client may also expose
-- them through PostgREST RPC without touching a protected table. Put the active-user condition
-- inside each private-data helper as well; the restrictive table policies alone cannot constrain
-- a direct function call.
create or replace function public.is_program_owner(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.is_active_auth_user())
    and exists (
      select 1
      from public.programs
      where id = target_program_id
        and owner_id = auth.uid()
    )
$$;

create or replace function public.is_program_reviewer(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.is_active_auth_user())
    and exists (
      select 1
      from public.program_reviewers
      where program_id = target_program_id
        and reviewer_id = auth.uid()
    )
$$;

create or replace function public.is_program_readable(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.programs
    where id = target_program_id
      and (
        public_status is not null
        or (
          (select public.is_active_auth_user())
          and (
            owner_id = auth.uid()
            or public.is_program_reviewer(id)
          )
        )
      )
  )
$$;

create or replace function public.can_access_report(target_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.is_active_auth_user())
    and exists (
      select 1
      from public.reports
      where reports.id = target_report_id
        and (
          reports.researcher_id = auth.uid()
          or public.is_program_owner(reports.program_id)
          or public.is_program_reviewer(reports.program_id)
        )
    )
$$;

create or replace function public.can_review_report(target_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.is_active_auth_user())
    and exists (
      select 1
      from public.reports
      where reports.id = target_report_id
        and (
          public.is_program_owner(reports.program_id)
          or public.is_program_reviewer(reports.program_id)
        )
    )
$$;

-- The application now onboards through its service-role API and
-- complete_profile_onboarding_for_user. Remove the legacy direct mutation path rather than relying
-- on table RLS that its owner-executed SECURITY DEFINER body bypasses.
revoke all on function public.complete_profile_onboarding(text, text)
from public, anon, authenticated;

do $install_active_auth_user_policies$
declare
  target record;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'storage'
      and relation.relname = 'objects'
      and relation.relkind in ('r', 'p')
      and relation.relrowsecurity
  ) then
    raise exception 'Storage RLS security boundary is unavailable';
  end if;

  for target in
    select namespace.nspname as schema_name, relation.relname as table_name
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
    where relation.relkind in ('r', 'p')
      and relation.relrowsecurity
      and (
        namespace.nspname = 'public'
        or (namespace.nspname = 'storage' and relation.relname = 'objects')
      )
    order by namespace.nspname, relation.relname
  loop
    execute format(
      'create policy authenticated_user_must_be_active on %I.%I as restrictive for all to authenticated using ((select public.is_active_auth_user())) with check ((select public.is_active_auth_user()))',
      target.schema_name,
      target.table_name
    );
  end loop;
end;
$install_active_auth_user_policies$;

comment on function public.is_active_auth_user() is
  'SEC-PROD-001 database boundary: false for missing, unknown, or currently banned Auth subjects.';
