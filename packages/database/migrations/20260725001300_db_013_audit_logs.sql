-- DB-013: Append-only security and business audit events with redacted metadata.

create table public.audit_logs (
  id uuid default gen_random_uuid()
    constraint audit_logs_pkey primary key,
  actor_id uuid
    constraint audit_logs_actor_id_fkey
      references public.profiles (id) on delete restrict,
  actor_type text not null
    constraint audit_logs_actor_type_check
      check (actor_type in ('user', 'system')),
  action text not null
    constraint audit_logs_action_check
      check (action ~ '^[a-z][a-z0-9._-]{0,127}$'),
  entity_type text not null
    constraint audit_logs_entity_type_check
      check (entity_type ~ '^[a-z][a-z0-9._-]{0,63}$'),
  entity_id text not null
    constraint audit_logs_entity_id_check
      check (
        length(entity_id) between 1 and 128
        and entity_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
      ),
  metadata jsonb not null default '{}'::jsonb
    constraint audit_logs_metadata_object_check
      check (jsonb_typeof(metadata) = 'object')
    constraint audit_logs_metadata_safe_check
      check (not public.jsonb_contains_forbidden_metadata_key(metadata)),
  created_at timestamp with time zone not null default now(),
  constraint audit_logs_actor_check
    check (
      (actor_type = 'user' and actor_id is not null)
      or (actor_type = 'system' and actor_id is null)
    )
);

comment on table public.audit_logs is
  'Append-only redacted events. Report content, credentials, signed URLs, update, and delete are prohibited.';

create or replace function public.prevent_audit_log_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'audit_logs is append-only'
    using errcode = '55000';
end;
$$;

create trigger audit_logs_prevent_update_delete
before update or delete on public.audit_logs
for each row
execute function public.prevent_audit_log_mutation();

alter table public.audit_logs enable row level security;
