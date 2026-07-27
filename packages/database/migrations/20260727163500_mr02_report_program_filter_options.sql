-- MR-02: complete Program filter options for the authenticated researcher's report dataset.
--
-- The API database client uses service_role, so RLS is not the server-side boundary. This
-- service-role-only read function repeats the list endpoint's researcher restriction explicitly
-- and performs the distinct/count operation in PostgreSQL instead of reading one paginated slice
-- (or materializing every private report in the API process).

create index if not exists reports_researcher_program_idx
  on public.reports (researcher_id, program_id);

create or replace function public.researcher_report_program_filter_options(actor_id uuid)
returns table (
  id uuid,
  name text,
  slug text,
  report_count bigint
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
    programs.id,
    programs.name,
    programs.slug,
    count(reports.id)::bigint
  from public.reports
  join public.programs on programs.id = reports.program_id
  where reports.researcher_id = actor_id
  group by programs.id, programs.name, programs.slug
  order by lower(programs.name), programs.name, programs.id;
end;
$$;

revoke all on function public.researcher_report_program_filter_options(uuid) from public;
grant execute on function public.researcher_report_program_filter_options(uuid) to service_role;
