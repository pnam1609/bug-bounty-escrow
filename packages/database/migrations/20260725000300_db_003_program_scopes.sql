-- DB-003: In-scope and out-of-scope assets owned by a bounty program.

create table public.program_scopes (
  id uuid default gen_random_uuid()
    constraint program_scopes_pkey primary key,
  program_id uuid not null
    constraint program_scopes_program_id_fkey
      references public.programs (id) on delete cascade,
  asset_type text not null
    constraint program_scopes_asset_type_check
      check (asset_type in ('smart_contract', 'website', 'api', 'mobile')),
  asset_name text not null
    constraint program_scopes_asset_name_check
      check (length(btrim(asset_name)) between 1 and 200),
  asset_url text
    constraint program_scopes_asset_url_check
      check (asset_url is null or length(asset_url) between 1 and 2000),
  contract_address text
    constraint program_scopes_contract_address_format_check
      check (contract_address is null or contract_address ~ '^0x[0-9a-fA-F]{40}$'),
  is_in_scope boolean not null default true,
  description text
    constraint program_scopes_description_check
      check (description is null or length(description) <= 2000),
  sort_order integer not null default 0
    constraint program_scopes_sort_order_check check (sort_order >= 0),
  -- Soft delete: reports.affected_scope_id references this row forever, so an owner editing the
  -- program must retire a scope rather than delete it.
  archived_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  -- Lets dependent rows prove, through a composite foreign key, that a referenced scope really
  -- belongs to the program they claim it does.
  constraint program_scopes_id_program_id_key unique (id, program_id),
  constraint program_scopes_id_program_asset_key unique (id, program_id, asset_type)
);

comment on constraint program_scopes_program_id_fkey on public.program_scopes is
  'Cascade because a scope has no lifecycle or ownership outside its parent program.';

comment on column public.program_scopes.archived_at is
  'Set instead of deleting. Archived scopes stay readable for historical reports but cannot be selected in new submissions.';

create index program_scopes_program_active_idx
  on public.program_scopes (program_id, is_in_scope, sort_order, id)
  where archived_at is null;

create trigger program_scopes_set_updated_at
before update on public.program_scopes
for each row
execute function public.set_updated_at();

alter table public.program_scopes enable row level security;
