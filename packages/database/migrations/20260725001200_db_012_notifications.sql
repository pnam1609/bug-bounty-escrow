-- DB-012: User notifications with recursively constrained safe metadata.

create or replace function public.jsonb_contains_forbidden_metadata_key(payload jsonb)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  entry record;
  normalized_key text;
begin
  case jsonb_typeof(payload)
    when 'object' then
      for entry in select key, value from jsonb_each(payload)
      loop
        normalized_key := regexp_replace(lower(entry.key), '[^a-z0-9]', '', 'g');

        if normalized_key = any (
          array[
            'authorization',
            'cookie',
            'password',
            'secret',
            'token',
            'apikey',
            'servicerolekey',
            'privatekey',
            'signedurl',
            'reporttitle',
            'reportcontent',
            'description',
            'impact',
            'reproduction',
            'reproductionsteps'
          ]
        ) then
          return true;
        end if;

        if public.jsonb_contains_forbidden_metadata_key(entry.value) then
          return true;
        end if;
      end loop;
    when 'array' then
      for entry in select value from jsonb_array_elements(payload)
      loop
        if public.jsonb_contains_forbidden_metadata_key(entry.value) then
          return true;
        end if;
      end loop;
    else
      return false;
  end case;

  return false;
end;
$$;

create table public.notifications (
  id uuid default gen_random_uuid()
    constraint notifications_pkey primary key,
  recipient_id uuid not null
    constraint notifications_recipient_id_fkey
      references public.profiles (id) on delete cascade,
  type text not null
    constraint notifications_type_check
      check (
        type in (
          'report_submitted',
          'information_requested',
          'report_resubmitted',
          'report_validated',
          'report_rejected',
          'report_duplicate',
          'reward_approved',
          'payment_pending',
          'payment_confirmed',
          'comment_added',
          'program_published',
          'disclosure_published'
        )
      ),
  metadata jsonb not null default '{}'::jsonb
    constraint notifications_metadata_object_check
      check (jsonb_typeof(metadata) = 'object')
    constraint notifications_metadata_safe_check
      check (not public.jsonb_contains_forbidden_metadata_key(metadata)),
  read_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  constraint notifications_read_at_check
    check (read_at is null or read_at >= created_at)
);

comment on column public.notifications.metadata is
  'Identifiers and routing metadata only; report content, secrets, tokens, and signed URLs are rejected.';

alter table public.notifications enable row level security;
