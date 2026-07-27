-- DB-005c: Owner decisions about publishing a resolved report after the program ends.
--
-- Deliberately a separate table from `reports`: a public "Known issues" query must be able to
-- read published disclosures without ever touching the private report body. There is no implicit
-- public, no bulk auto-public, and no public-by-timeout — a row only exists once an owner decided.

create table public.report_disclosures (
  id uuid default gen_random_uuid()
    constraint report_disclosures_pkey primary key,
  report_id uuid not null,
  program_id uuid not null,
  decision text not null
    constraint report_disclosures_decision_check
      check (decision in ('keep_private', 'publish_summary', 'publish_full')),
  decided_by uuid not null
    constraint report_disclosures_decided_by_fkey
      references public.profiles (id) on delete restrict,
  decided_at timestamp with time zone not null default now(),

  -- Public-safe copies written by the owner. Never a projection of the private report body.
  public_title text
    constraint report_disclosures_public_title_check
      check (public_title is null or length(btrim(public_title)) between 1 and 300),
  public_summary text
    constraint report_disclosures_public_summary_check
      check (public_summary is null or length(btrim(public_summary)) between 1 and 5000),
  public_content text
    constraint report_disclosures_public_content_check
      check (public_content is null or length(btrim(public_content)) between 1 and 50000),
  public_severity text
    constraint report_disclosures_public_severity_check
      check (
        public_severity is null
        or public_severity in ('critical', 'high', 'medium', 'low', 'informational')
      ),
  published_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),

  constraint report_disclosures_report_key unique (report_id),
  constraint report_disclosures_report_fkey
    foreign key (report_id, program_id)
    references public.reports (id, program_id)
    on delete restrict,
  constraint report_disclosures_private_shape_check
    check (
      decision <> 'keep_private'
      or (
        published_at is null
        and public_title is null
        and public_summary is null
        and public_content is null
        and public_severity is null
      )
    ),
  constraint report_disclosures_summary_shape_check
    check (
      decision <> 'publish_summary'
      or (
        published_at is not null
        and public_title is not null
        and public_summary is not null
        and public_severity is not null
        and public_content is null
      )
    ),
  constraint report_disclosures_full_shape_check
    check (
      decision <> 'publish_full'
      or (
        published_at is not null
        and public_title is not null
        and public_summary is not null
        and public_severity is not null
        and public_content is not null
      )
    ),
  constraint report_disclosures_published_at_check
    check (published_at is null or published_at >= created_at)
);

comment on table public.report_disclosures is
  'Public-safe disclosure content only. Reading this table must never require joining public.reports.';

create index report_disclosures_program_published_idx
  on public.report_disclosures (program_id, published_at desc, id)
  where published_at is not null;

create trigger report_disclosures_set_updated_at
before update on public.report_disclosures
for each row
execute function public.set_updated_at();

alter table public.report_disclosures enable row level security;
