-- MR-01: whole-result-set summary metrics for the authenticated researcher's reports.
--
-- The API database client uses service_role, so this function repeats both the researcher role
-- and report ownership boundaries. PostgreSQL performs every count and the paid-reward sum in one
-- aggregate query; PostgREST row limits and list pagination therefore cannot truncate the result.

create or replace function public.researcher_report_summary(actor_id uuid)
returns table (
  all_reports bigint,
  needs_information bigint,
  under_review bigint,
  rewards_paid text
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1
    from public.profiles
    where profiles.id = actor_id
      and profiles.role = 'researcher'
  ) then
    perform public.reject_forbidden('researcher_role_required');
  end if;

  return query
  select
    count(reports.id)::bigint,
    count(reports.id) filter (where reports.status = 'needs_information')::bigint,
    count(reports.id) filter (where reports.status in ('submitted', 'triaged'))::bigint,
    coalesce(
      sum(reports.approved_reward) filter (where reports.status = 'paid'),
      0
    )::numeric(30, 6)::text
  from public.reports
  where reports.researcher_id = actor_id;
end;
$$;

revoke all on function public.researcher_report_summary(uuid) from public;
grant execute on function public.researcher_report_summary(uuid) to service_role;
