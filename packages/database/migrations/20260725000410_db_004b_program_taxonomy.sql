-- DB-004b: Program tags, resource links, impact catalog, and prohibited-activity snapshots.
--
-- Everything here is program-owned. Platform-provided impact templates and default prohibited
-- rules are copied into these tables at create time, so later edits to the platform catalog can
-- never silently change the terms of a program researchers are already working against.

create table public.program_tags (
  id uuid default gen_random_uuid()
    constraint program_tags_pkey primary key,
  program_id uuid not null
    constraint program_tags_program_id_fkey
      references public.programs (id) on delete cascade,
  label text not null
    constraint program_tags_label_check check (length(btrim(label)) between 1 and 40),
  normalized_tag text
    generated always as (
      btrim(regexp_replace(lower(btrim(label)), '[^a-z0-9]+', '-', 'g'), '-')
    ) stored,
  created_at timestamp with time zone not null default now(),
  constraint program_tags_program_normalized_key unique (program_id, normalized_tag)
);

create index program_tags_normalized_idx on public.program_tags (normalized_tag, program_id);

create table public.program_resources (
  id uuid default gen_random_uuid()
    constraint program_resources_pkey primary key,
  program_id uuid not null
    constraint program_resources_program_id_fkey
      references public.programs (id) on delete cascade,
  resource_type text not null
    constraint program_resources_type_check
      check (resource_type in ('documentation', 'repository', 'audit', 'website', 'other')),
  title text not null
    constraint program_resources_title_check check (length(btrim(title)) between 1 and 120),
  url text not null
    -- Length is checked separately: PostgreSQL regexes cap {m,n} repetition at 255.
    constraint program_resources_url_check
      check (length(url) <= 2000 and url ~* '^https://[^[:space:]]+$'),
  sort_order integer not null default 0
    constraint program_resources_sort_order_check check (sort_order >= 0),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index program_resources_program_sort_idx
  on public.program_resources (program_id, sort_order, id);

create trigger program_resources_set_updated_at
before update on public.program_resources
for each row
execute function public.set_updated_at();

-- Impact catalog: the exact list a researcher picks from in Submit Bug, scoped per asset type.
create table public.program_impacts (
  id uuid default gen_random_uuid()
    constraint program_impacts_pkey primary key,
  program_id uuid not null
    constraint program_impacts_program_id_fkey
      references public.programs (id) on delete cascade,
  asset_type text not null
    constraint program_impacts_asset_type_check
      check (asset_type in ('smart_contract', 'website', 'api', 'mobile')),
  severity text not null
    constraint program_impacts_severity_check
      check (severity in ('critical', 'high', 'medium', 'low', 'informational')),
  title text not null
    constraint program_impacts_title_check check (length(btrim(title)) between 1 and 300),
  normalized_title text
    generated always as (
      btrim(regexp_replace(lower(btrim(title)), '[^a-z0-9]+', ' ', 'g'))
    ) stored,
  description text
    constraint program_impacts_description_check
      check (description is null or length(description) <= 2000),
  source text not null default 'custom'
    constraint program_impacts_source_check check (source in ('template', 'custom')),
  template_key text
    constraint program_impacts_template_key_check
      check (template_key is null or template_key ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  enabled boolean not null default true,
  sort_order integer not null default 0
    constraint program_impacts_sort_order_check check (sort_order >= 0),
  -- Soft delete: report_impacts keeps a foreign key to the impact that was selected.
  archived_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint program_impacts_program_asset_title_key
    unique (program_id, asset_type, normalized_title),
  -- Referenced by report_impacts to prove the impact belongs to the report's program.
  constraint program_impacts_id_program_key unique (id, program_id),
  constraint program_impacts_id_program_asset_key unique (id, program_id, asset_type),
  constraint program_impacts_template_source_check
    check ((source = 'template') = (template_key is not null))
);

comment on column public.program_impacts.template_key is
  'Provenance of a copied platform template. Intentionally not a foreign key: the row is a snapshot.';

comment on column public.program_impacts.archived_at is
  'Archived impacts stay selectable in historical reports but disappear from the submit form.';

create index program_impacts_program_asset_enabled_idx
  on public.program_impacts (program_id, asset_type, sort_order, id)
  where archived_at is null and enabled;

create trigger program_impacts_set_updated_at
before update on public.program_impacts
for each row
execute function public.set_updated_at();

create table public.program_prohibited_activities (
  id uuid default gen_random_uuid()
    constraint program_prohibited_activities_pkey primary key,
  program_id uuid not null
    constraint program_prohibited_activities_program_id_fkey
      references public.programs (id) on delete cascade,
  source text not null
    constraint program_prohibited_activities_source_check
      check (source in ('platform_default', 'custom')),
  rule_key text
    constraint program_prohibited_activities_rule_key_check
      check (rule_key is null or rule_key ~ '^[a-z][a-z0-9_.-]{0,127}$'),
  body text not null
    constraint program_prohibited_activities_body_check
      check (length(btrim(body)) between 1 and 1000),
  sort_order integer not null default 0
    constraint program_prohibited_activities_sort_order_check check (sort_order >= 0),
  created_at timestamp with time zone not null default now(),
  constraint program_prohibited_activities_default_key_check
    check ((source = 'platform_default') = (rule_key is not null)),
  constraint program_prohibited_activities_program_rule_key
    unique (program_id, rule_key)
);

comment on table public.program_prohibited_activities is
  'Snapshot of platform default rules plus owner additions. Defaults are copied, never referenced.';

create index program_prohibited_activities_program_sort_idx
  on public.program_prohibited_activities (program_id, sort_order, id);

alter table public.program_tags enable row level security;
alter table public.program_resources enable row level security;
alter table public.program_impacts enable row level security;
alter table public.program_prohibited_activities enable row level security;
