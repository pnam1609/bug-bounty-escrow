\set ON_ERROR_STOP on

-- Core-schema verification: profiles, programs, program_scopes and program_reward_tiers only.
-- Runs against a database with just DB-001..DB-004 applied, so it can assert the behaviour of
-- those four tables in isolation. The full-schema equivalent lives in
-- tests/backend-foundation/verify_schema.sql.

begin;

do $core_tables$
declare
  expected_table text;
begin
  foreach expected_table in array array[
    'profiles',
    'programs',
    'program_scopes',
    'program_reward_tiers'
  ]
  loop
    if to_regclass('public.' || expected_table) is null then
      raise exception 'Missing table public.%', expected_table;
    end if;

    if not (
      select relrowsecurity from pg_class where oid = to_regclass('public.' || expected_table)
    ) then
      raise exception 'RLS is not enabled on public.%', expected_table;
    end if;
  end loop;
end;
$core_tables$;

do $profile_defaults$
declare
  assigned_role text;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (
    '91000000-0000-4000-8000-000000000001',
    'core-user@example.test',
    '{"display_name":"Core User","role":"owner"}'
  );

  -- Profile bootstrap must never honour a role claimed in auth metadata.
  insert into public.profiles (id, display_name)
  values ('91000000-0000-4000-8000-000000000001', 'Core User')
  on conflict (id) do nothing;

  select role into assigned_role from public.profiles
  where id = '91000000-0000-4000-8000-000000000001';

  if assigned_role <> 'researcher' then
    raise exception 'Profile creation granted % instead of the researcher default', assigned_role;
  end if;
end;
$profile_defaults$;

do $program_identity$
declare
  owner_uuid uuid := '91000000-0000-4000-8000-000000000001';
  program_uuid uuid := '91000000-0000-4000-8000-000000000100';
  caught text;
begin
  update public.profiles set role = 'owner' where id = owner_uuid;

  insert into public.programs (
    id, owner_id, name, slug, short_summary, description, website_url, status, total_pool
  )
  values (
    program_uuid, owner_uuid, 'Core program', 'core-program',
    'Core summary', 'Core description', 'https://core.example.test', 'draft', 0
  );

  -- Slug is the public URL key and must stay lowercase kebab-case and unique.
  begin
    insert into public.programs (
      id, owner_id, name, slug, short_summary, description, website_url
    )
    values (
      '91000000-0000-4000-8000-000000000101', owner_uuid, 'Bad slug', 'Not A Slug',
      'Summary', 'Description', 'https://bad.example.test'
    );
    raise exception 'An invalid slug was accepted';
  exception
    when check_violation then
      get stacked diagnostics caught = constraint_name;
      if caught <> 'programs_slug_format_check' then
        raise exception 'Unexpected slug constraint %', caught;
      end if;
  end;

  begin
    insert into public.programs (
      id, owner_id, name, slug, short_summary, description, website_url
    )
    values (
      '91000000-0000-4000-8000-000000000102', owner_uuid, 'Duplicate', 'core-program',
      'Summary', 'Description', 'https://dup.example.test'
    );
    raise exception 'A duplicate slug was accepted';
  exception
    when unique_violation then null;
  end;

  -- Plain HTTP would be rendered to researchers as an official link.
  begin
    insert into public.programs (
      id, owner_id, name, slug, short_summary, description, website_url
    )
    values (
      '91000000-0000-4000-8000-000000000103', owner_uuid, 'Insecure', 'insecure-program',
      'Summary', 'Description', 'http://insecure.example.test'
    );
    raise exception 'A non-HTTPS website was accepted';
  exception
    when check_violation then null;
  end;

  -- A program cannot claim to be live without ever having been published.
  begin
    update public.programs set status = 'active' where id = program_uuid;
    raise exception 'A program went active without a published_at timestamp';
  exception
    when check_violation then
      get stacked diagnostics caught = constraint_name;
      if caught <> 'programs_published_state_check' then
        raise exception 'Unexpected publication constraint %', caught;
      end if;
  end;
end;
$program_identity$;

do $scope_and_tiers$
declare
  program_uuid uuid := '91000000-0000-4000-8000-000000000100';
  scope_uuid uuid := '91000000-0000-4000-8000-000000000200';
begin
  insert into public.program_scopes (
    id, program_id, asset_type, asset_name, is_in_scope
  )
  values (scope_uuid, program_uuid, 'smart_contract', 'Core contract', true);

  begin
    insert into public.program_scopes (program_id, asset_type, asset_name, contract_address)
    values (program_uuid, 'smart_contract', 'Bad address', '0xnot-an-address');
    raise exception 'An invalid contract address was accepted';
  exception
    when check_violation then null;
  end;

  -- Archiving is how a referenced scope is retired, so the column has to exist.
  update public.program_scopes set archived_at = now() where id = scope_uuid;
  update public.program_scopes set archived_at = null where id = scope_uuid;

  insert into public.program_reward_tiers (
    program_id, asset_type, severity, calculation_type, min_reward, max_reward
  )
  values (program_uuid, 'smart_contract', 'critical', 'range', 1000, 50000);

  begin
    insert into public.program_reward_tiers (
      program_id, asset_type, severity, calculation_type, min_reward, max_reward
    )
    values (program_uuid, 'smart_contract', 'high', 'range', 5000, 1000);
    raise exception 'A tier with a maximum below its minimum was accepted';
  exception
    when check_violation then null;
  end;

  begin
    insert into public.program_reward_tiers (
      program_id, asset_type, severity, calculation_type, percentage_bps
    )
    values (program_uuid, 'smart_contract', 'medium', 'percentage', 1000);
    raise exception 'A percentage tier without a cap was accepted';
  exception
    when check_violation then null;
  end;

  insert into public.program_reward_tiers (
    program_id, asset_type, severity, calculation_type, percentage_bps, max_reward_cap
  )
  values (program_uuid, 'smart_contract', 'medium', 'percentage', 1000, 250000);
end;
$scope_and_tiers$;

rollback;
