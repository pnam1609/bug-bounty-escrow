-- CP-02: POST /api/programs target-contract rules the atomic RPCs did not yet enforce.
--
-- The Zod layer (createProgramRequestSchema) already rejects these payloads at the edge, but the
-- flow doc makes them business rules of the data contract, and business rules live in the
-- database (PROJECT_CONTEXT §9 / AC 12). Each rule raises through reject_business so the
-- machine-readable detail lands in the HTTP `error.code` unchanged.
--
-- New rule codes:
--   asset_type_not_enabled              write payload names an asset type the product has not
--                                       enabled (`api`, `mobile` stay enum-only until their
--                                       editors ship; silently storing them would create assets
--                                       no UI can manage).
--   reward_tier_duplicate               one payload lists the same (assetType, severity) twice.
--                                       Without this the per-row upsert silently merged the
--                                       duplicates, second row winning.
--   impact_title_duplicate              one payload lists two impacts of one asset type whose
--                                       normalized titles collide. Previously this surfaced as a
--                                       raw unique-constraint error with no rule code.
--   impact_asset_type_not_in_scope      created program would own an impact for an asset type
--                                       that has no scope entry at all (create path only).
--   reward_tier_asset_type_not_in_scope same, for reward tiers (create path only).
--   deadline_not_in_future              create payload carries a deadline at or before now().
--
-- write_program_children is shared with update_program_atomic. The three payload-shape rules
-- (enabled asset types, duplicate tiers, duplicate impact titles) intentionally apply to update
-- as well: such a payload is invalid regardless of stored state. The two *_not_in_scope rules and
-- the deadline rule are create-only, because an existing program may legitimately hold archived
-- scopes (see the scope-edit workflow) or an already-elapsed deadline.
--
-- Bug fix carried in the same replacement: the scope and impact reconciliation sweeps matched on
-- the ids present in the payload only, so rows INSERTED BY THE VERY SAME CALL (which have
-- server-generated ids) were deleted again before the function returned. Creating a program
-- therefore persisted zero scopes and zero impacts, and assert_program_coverage passed vacuously
-- because no live in-scope asset type remained. The sweeps now also keep every row inserted in
-- this call. (Caught by the new reward_tier_asset_type_not_in_scope assertion.)
--
-- CREATE OR REPLACE keeps the ownership and the existing service_role grants of the replaced
-- functions, so no grants are repeated here.
--
-- Rollback: re-apply the function bodies from 20260725002100_offchain_atomic_rpcs.sql, then
--   drop function public.assert_program_asset_types_scoped(uuid);
--   delete from public.schema_migrations
--     where version = '20260727060410_cp02_create_program_contract_rules.sql';

-- Every live impact and reward tier must point at an asset type that has at least one scope
-- entry (in or out of scope). Called from create_program_atomic only — updates may temporarily
-- diverge while archived scopes keep report history alive.
create or replace function public.assert_program_asset_types_scoped(target_program_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if exists (
    select 1 from public.program_impacts impact
    where impact.program_id = target_program_id
      and impact.archived_at is null
      and not exists (
        select 1 from public.program_scopes scope
        where scope.program_id = target_program_id
          and scope.asset_type = impact.asset_type
          and scope.archived_at is null
      )
  ) then
    perform public.reject_business('impact_asset_type_not_in_scope');
  end if;

  if exists (
    select 1 from public.program_reward_tiers tier
    where tier.program_id = target_program_id
      and tier.archived_at is null
      and not exists (
        select 1 from public.program_scopes scope
        where scope.program_id = target_program_id
          and scope.asset_type = tier.asset_type
          and scope.archived_at is null
      )
  ) then
    perform public.reject_business('reward_tier_asset_type_not_in_scope');
  end if;
end;
$$;

revoke all on function public.assert_program_asset_types_scoped(uuid) from public;

-- Replaces the full child-collection state of a program from `input`.
-- Scopes and impacts are upserted by id and soft-deleted when still referenced, because
-- reports.affected_scope_id and report_impacts.program_impact_id keep pointing at them.
create or replace function public.write_program_children(
  target_program_id uuid,
  input jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  kept_scope_ids uuid[];
  kept_impact_ids uuid[];
  inserted_child_id uuid;
  row_input record;
begin
  ------------------------------------------------------------------ payload contract (CP-02)
  -- Write endpoints only accept the asset types the product renders an editor for. The list
  -- mirrors PRODUCT_ENABLED_ASSET_TYPES in packages/domain; `api` and `mobile` stay readable in
  -- stored rows but must not be creatable until their UI ships.
  if exists (
    select 1
    from (
      select value ->> 'assetType' as asset_type
      from jsonb_array_elements(coalesce(input -> 'scopes', '[]'::jsonb))
      union all
      select value ->> 'assetType'
      from jsonb_array_elements(coalesce(input -> 'impacts', '[]'::jsonb))
      union all
      select value ->> 'assetType'
      from jsonb_array_elements(coalesce(input -> 'rewardTiers', '[]'::jsonb))
    ) supplied
    where supplied.asset_type is not null
      and supplied.asset_type not in ('smart_contract', 'website')
  ) then
    perform public.reject_business('asset_type_not_enabled');
  end if;

  -- A tier is unique per (asset type, severity). Listing the pair twice in one payload used to
  -- fall into the upsert below and merge silently, second row winning.
  if input ? 'rewardTiers' and exists (
    select 1
    from jsonb_to_recordset(input -> 'rewardTiers')
      as tier_row("assetType" text, severity text)
    group by tier_row."assetType", tier_row.severity
    having count(*) > 1
  ) then
    perform public.reject_business('reward_tier_duplicate');
  end if;

  -- Impact titles are unique per asset type on their normalized form; keep this expression
  -- identical to the generated column program_impacts.normalized_title.
  if input ? 'impacts' and exists (
    select 1
    from jsonb_to_recordset(input -> 'impacts')
      as impact_row("assetType" text, title text)
    group by impact_row."assetType",
      btrim(regexp_replace(lower(btrim(impact_row.title)), '[^a-z0-9]+', ' ', 'g'))
    having count(*) > 1
  ) then
    perform public.reject_business('impact_title_duplicate');
  end if;

  ------------------------------------------------------------------ scopes
  if input ? 'scopes' then
    kept_scope_ids := coalesce((
      select array_agg((value ->> 'id')::uuid)
      from jsonb_array_elements(input -> 'scopes')
      where value ->> 'id' is not null
    ), '{}'::uuid[]);

    for row_input in
      select *
      from jsonb_to_recordset(input -> 'scopes') as scope_row(
        id uuid,
        "assetType" text,
        "assetName" text,
        "assetUrl" text,
        "contractAddress" text,
        "isInScope" boolean,
        description text,
        "sortOrder" integer
      )
    loop
      if row_input.id is null then
        insert into public.program_scopes (
          program_id, asset_type, asset_name, asset_url,
          contract_address, is_in_scope, description, sort_order
        )
        values (
          target_program_id,
          row_input."assetType",
          row_input."assetName",
          row_input."assetUrl",
          row_input."contractAddress",
          coalesce(row_input."isInScope", true),
          row_input.description,
          coalesce(row_input."sortOrder", 0)
        )
        returning id into inserted_child_id;

        -- Rows born in this call must survive the reconciliation sweep below.
        kept_scope_ids := kept_scope_ids || inserted_child_id;
      else
        update public.program_scopes
        set
          asset_type = row_input."assetType",
          asset_name = row_input."assetName",
          asset_url = row_input."assetUrl",
          contract_address = row_input."contractAddress",
          is_in_scope = coalesce(row_input."isInScope", true),
          description = row_input.description,
          sort_order = coalesce(row_input."sortOrder", 0),
          archived_at = null
        where id = row_input.id and program_id = target_program_id;

        if not found then
          perform public.reject_business('program_not_accessible');
        end if;
      end if;
    end loop;

    -- Unreferenced removals can go; referenced ones must survive as archived history.
    delete from public.program_scopes scope
    where scope.program_id = target_program_id
      and scope.archived_at is null
      and not (scope.id = any (kept_scope_ids))
      and not exists (
        select 1 from public.reports report where report.affected_scope_id = scope.id
      );

    update public.program_scopes
    set archived_at = now(), is_in_scope = false
    where program_id = target_program_id
      and archived_at is null
      and not (id = any (kept_scope_ids));
  end if;

  ------------------------------------------------------------------ impacts
  if input ? 'impacts' then
    kept_impact_ids := coalesce((
      select array_agg((value ->> 'id')::uuid)
      from jsonb_array_elements(input -> 'impacts')
      where value ->> 'id' is not null
    ), '{}'::uuid[]);

    for row_input in
      select *
      from jsonb_to_recordset(input -> 'impacts') as impact_row(
        id uuid,
        "assetType" text,
        severity text,
        title text,
        description text,
        source text,
        "templateKey" text,
        enabled boolean,
        "sortOrder" integer
      )
    loop
      if row_input.id is null then
        insert into public.program_impacts (
          program_id, asset_type, severity, title, description,
          source, template_key, enabled, sort_order
        )
        values (
          target_program_id,
          row_input."assetType",
          row_input.severity,
          row_input.title,
          row_input.description,
          coalesce(row_input.source, 'custom'),
          row_input."templateKey",
          coalesce(row_input.enabled, true),
          coalesce(row_input."sortOrder", 0)
        )
        returning id into inserted_child_id;

        -- Rows born in this call must survive the reconciliation sweep below.
        kept_impact_ids := kept_impact_ids || inserted_child_id;
      else
        update public.program_impacts
        set
          asset_type = row_input."assetType",
          severity = row_input.severity,
          title = row_input.title,
          description = row_input.description,
          enabled = coalesce(row_input.enabled, true),
          sort_order = coalesce(row_input."sortOrder", 0),
          archived_at = null
        where id = row_input.id and program_id = target_program_id;

        if not found then
          perform public.reject_business('program_not_accessible');
        end if;
      end if;
    end loop;

    delete from public.program_impacts impact
    where impact.program_id = target_program_id
      and impact.archived_at is null
      and not (impact.id = any (kept_impact_ids))
      and not exists (
        select 1 from public.report_impacts selected
        where selected.program_impact_id = impact.id
      );

    update public.program_impacts
    set archived_at = now(), enabled = false
    where program_id = target_program_id
      and archived_at is null
      and not (id = any (kept_impact_ids));
  end if;

  ------------------------------------------------------------------ reward tiers
  -- No foreign key points here (reports denormalize approved_reward), so a full replace is safe.
  if input ? 'rewardTiers' then
    for row_input in
      select *
      from jsonb_to_recordset(input -> 'rewardTiers') as tier_row(
        "assetType" text,
        severity text,
        "calculationType" text,
        "minReward" text,
        "maxReward" text,
        "flatAmount" text,
        "percentageBps" integer,
        "maxRewardCap" text,
        "calculationNote" text
      )
    loop
      insert into public.program_reward_tiers (
        program_id, asset_type, severity, calculation_type,
        min_reward, max_reward, flat_amount, percentage_bps, max_reward_cap, calculation_note
      )
      values (
        target_program_id,
        row_input."assetType",
        row_input.severity,
        coalesce(row_input."calculationType", 'range'),
        nullif(row_input."minReward", '')::numeric,
        nullif(row_input."maxReward", '')::numeric,
        nullif(row_input."flatAmount", '')::numeric,
        row_input."percentageBps",
        nullif(row_input."maxRewardCap", '')::numeric,
        row_input."calculationNote"
      )
      on conflict (program_id, asset_type, severity) where archived_at is null do update
      set
        calculation_type = excluded.calculation_type,
        min_reward = excluded.min_reward,
        max_reward = excluded.max_reward,
        flat_amount = excluded.flat_amount,
        percentage_bps = excluded.percentage_bps,
        max_reward_cap = excluded.max_reward_cap,
        calculation_note = excluded.calculation_note;
    end loop;

    -- A tier that already priced an approved reward is part of that payment record, so it is
    -- archived rather than deleted. Tiers with no history can go.
    delete from public.program_reward_tiers tier
    where tier.program_id = target_program_id
      and tier.archived_at is null
      and not exists (
        select 1
        from jsonb_to_recordset(input -> 'rewardTiers')
          as tier_row("assetType" text, severity text)
        where tier_row."assetType" = tier.asset_type
          and tier_row.severity = tier.severity
      )
      and not exists (
        select 1
        from public.reports report
        join public.program_scopes scope on scope.id = report.affected_scope_id
        where report.program_id = target_program_id
          and report.final_severity = tier.severity
          and scope.asset_type = tier.asset_type
          and report.status in ('reward_approved', 'payment_pending', 'paid')
      );

    update public.program_reward_tiers tier
    set archived_at = now()
    where tier.program_id = target_program_id
      and tier.archived_at is null
      and not exists (
        select 1
        from jsonb_to_recordset(input -> 'rewardTiers')
          as tier_row("assetType" text, severity text)
        where tier_row."assetType" = tier.asset_type
          and tier_row.severity = tier.severity
      );
  end if;

  ------------------------------------------------------------------ tags
  if input ? 'tags' then
    delete from public.program_tags where program_id = target_program_id;

    insert into public.program_tags (program_id, label)
    select target_program_id, element #>> '{}'
    from jsonb_array_elements(input -> 'tags') as arr(element)
    on conflict on constraint program_tags_program_normalized_key do nothing;
  end if;

  ------------------------------------------------------------------ resources
  if input ? 'resources' then
    delete from public.program_resources where program_id = target_program_id;

    insert into public.program_resources (program_id, resource_type, title, url, sort_order)
    select
      target_program_id,
      element ->> 'resourceType',
      element ->> 'title',
      element ->> 'url',
      coalesce((element ->> 'sortOrder')::integer, (position - 1)::integer)
    from jsonb_array_elements(input -> 'resources')
      with ordinality as arr(element, position);
  end if;

  ------------------------------------------------------------------ prohibited activities
  if input #> '{rules,prohibitedActivities}' is not null then
    delete from public.program_prohibited_activities
    where program_id = target_program_id and source = 'custom';

    insert into public.program_prohibited_activities (
      program_id, source, rule_key, body, sort_order
    )
    select
      target_program_id,
      'custom',
      null,
      element #>> '{}',
      (100 + position - 1)::integer
    from jsonb_array_elements(input #> '{rules,prohibitedActivities}')
      with ordinality as arr(element, position)
    where length(btrim(element #>> '{}')) > 0;
  end if;

  perform public.refresh_program_projection(target_program_id);
end;
$$;

create or replace function public.create_program_atomic(
  actor_id uuid,
  input jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  created_program_id uuid;
begin
  if not exists (
    select 1 from public.profiles
    where id = actor_id and role = 'owner'
  ) then
    perform public.reject_forbidden('owner_role_required');
  end if;

  -- CP-02: a deadline is optional, but a program cannot be born already past it.
  if nullif(input ->> 'deadline', '') is not null
    and (input ->> 'deadline')::timestamp with time zone <= now()
  then
    perform public.reject_business('deadline_not_in_future');
  end if;

  insert into public.programs (
    owner_id,
    name,
    slug,
    short_summary,
    description,
    website_url,
    logo_storage_path,
    deadline,
    poc_policy,
    poc_policy_note,
    reward_policy,
    testing_restrictions,
    submission_acknowledgment,
    allow_custom_impact
  )
  values (
    actor_id,
    input ->> 'name',
    input ->> 'slug',
    input ->> 'shortSummary',
    input ->> 'description',
    input ->> 'websiteUrl',
    input ->> 'logoStoragePath',
    nullif(input ->> 'deadline', '')::timestamp with time zone,
    coalesce(input #>> '{rules,pocPolicy}', 'required'),
    input #>> '{rules,pocPolicyNote}',
    input #>> '{rules,rewardPolicy}',
    input #>> '{rules,testingRestrictions}',
    input #>> '{rules,submissionAcknowledgment}',
    coalesce((input #>> '{rules,allowCustomImpact}')::boolean, true)
  )
  returning id into created_program_id;

  -- Snapshot the platform baseline so later platform edits never change a live program's terms.
  insert into public.program_prohibited_activities (
    program_id, source, rule_key, body, sort_order
  )
  select created_program_id, 'platform_default', defaults.rule_key, defaults.body,
    defaults.sort_order
  from public.platform_prohibited_activities() as defaults;

  perform public.write_program_children(created_program_id, input);
  perform public.assert_program_coverage(created_program_id);
  perform public.assert_program_asset_types_scoped(created_program_id);

  insert into public.audit_logs (
    actor_id, actor_type, action, entity_type, entity_id, metadata
  )
  values (
    actor_id, 'user', 'program.created', 'program', created_program_id::text,
    jsonb_build_object('slug', input ->> 'slug')
  );

  return created_program_id;
end;
$$;
