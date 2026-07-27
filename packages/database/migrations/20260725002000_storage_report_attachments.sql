-- STO-001/STO-002: Private attachment bucket and canonical report-object policies.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'report-attachments',
  'report-attachments',
  false,
  10485760,
  array[
    'text/plain',
    'text/markdown',
    'application/json',
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_report_id(object_name text)
returns uuid
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when object_name ~
      '^reports/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$'
    then split_part(object_name, '/', 2)::uuid
    else null
  end;
$$;

create policy report_attachments_objects_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'report-attachments'
  and public.storage_report_id(name) is not null
  and public.can_access_report(public.storage_report_id(name))
);

create policy report_attachments_objects_insert
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'report-attachments'
  and public.storage_report_id(name) is not null
  and public.can_access_report(public.storage_report_id(name))
);

create policy report_attachments_objects_delete
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'report-attachments'
  and public.storage_report_id(name) is not null
  and exists (
    select 1
    from public.reports
    where reports.id = public.storage_report_id(name)
      and reports.researcher_id = auth.uid()
      and reports.status in ('draft', 'needs_information')
  )
);

-- STO-003: Program logos.
--
-- Public-read on purpose: a logo is public branding that renders in the anonymous bounty table,
-- and signing a URL per row would make list rendering needlessly expensive. Object names embed
-- the program UUID so they are not enumerable, and only owners may write.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'program-logos',
  'program-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_program_id(object_name text)
returns uuid
language sql
immutable
set search_path = pg_catalog
as $$
  select case
    when object_name ~
      '^programs/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$'
    then split_part(object_name, '/', 2)::uuid
    else null
  end;
$$;

create policy program_logo_objects_write_owner
on storage.objects
for all
to authenticated
using (
  bucket_id = 'program-logos'
  and public.storage_program_id(name) is not null
  and public.is_program_owner(public.storage_program_id(name))
)
with check (
  bucket_id = 'program-logos'
  and public.storage_program_id(name) is not null
  and public.is_program_owner(public.storage_program_id(name))
);
