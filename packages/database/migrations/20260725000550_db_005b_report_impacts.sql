-- DB-005b: Impacts selected on a report, replacing the free-text reports.impact field.
--
-- A report claims one or more impacts from the program's catalog, plus optional researcher-
-- proposed impacts when the program allows them. Titles and severities are snapshotted so an
-- owner editing the catalog later cannot rewrite the content of an already submitted report.

create table public.report_impacts (
  id uuid default gen_random_uuid()
    constraint report_impacts_pkey primary key,
  report_id uuid not null,
  program_id uuid not null,
  program_impact_id uuid,
  source text not null
    constraint report_impacts_source_check check (source in ('program', 'custom')),
  custom_title text
    constraint report_impacts_custom_title_check
      check (custom_title is null or length(btrim(custom_title)) between 1 and 300),
  impact_title_snapshot text not null
    constraint report_impacts_title_snapshot_check
      check (length(btrim(impact_title_snapshot)) between 1 and 300),
  impact_severity_snapshot text
    constraint report_impacts_severity_snapshot_check
      check (
        impact_severity_snapshot is null
        or impact_severity_snapshot in ('critical', 'high', 'medium', 'low', 'informational')
      ),
  asset_type_snapshot text not null
    constraint report_impacts_asset_type_snapshot_check
      check (asset_type_snapshot in ('smart_contract', 'website', 'api', 'mobile')),
  created_at timestamp with time zone not null default now(),

  constraint report_impacts_report_fkey
    foreign key (report_id, program_id)
    references public.reports (id, program_id)
    on delete cascade,
  -- MATCH SIMPLE: skipped entirely when program_impact_id is null (a custom impact). When it is
  -- set, this proves in the database that the impact belongs to this program AND matches the
  -- asset type recorded on the report row.
  constraint report_impacts_program_impact_fkey
    foreign key (program_impact_id, program_id, asset_type_snapshot)
    references public.program_impacts (id, program_id, asset_type)
    on delete restrict,
  constraint report_impacts_shape_check
    check (
      (
        source = 'program'
        and program_impact_id is not null
        and custom_title is null
        and impact_severity_snapshot is not null
      )
      or (
        source = 'custom'
        and program_impact_id is null
        and custom_title is not null
      )
    ),
  constraint report_impacts_unique_selection
    unique nulls not distinct (report_id, program_impact_id, custom_title)
);

comment on table public.report_impacts is
  'At least one row per submitted report; enforced by submit_report_atomic, not by a table constraint.';

comment on column public.report_impacts.impact_severity_snapshot is
  'Severity of the catalog impact at submission time. Null for custom impacts: a researcher-proposed impact carries no program-blessed severity.';

create index report_impacts_report_idx on public.report_impacts (report_id, id);
create index report_impacts_program_impact_idx
  on public.report_impacts (program_impact_id)
  where program_impact_id is not null;

alter table public.report_impacts enable row level security;
