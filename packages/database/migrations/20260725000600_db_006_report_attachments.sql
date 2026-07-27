-- DB-006: Metadata for report files stored in a private Supabase bucket.

create table public.report_attachments (
  id uuid default gen_random_uuid()
    constraint report_attachments_pkey primary key,
  report_id uuid not null
    constraint report_attachments_report_id_fkey
      references public.reports (id) on delete restrict,
  uploader_id uuid not null
    constraint report_attachments_uploader_id_fkey
      references public.profiles (id) on delete restrict,
  storage_bucket text not null
    constraint report_attachments_storage_bucket_check
      check (
        length(btrim(storage_bucket)) between 1 and 100
        and storage_bucket ~ '^[a-z0-9][a-z0-9._-]*$'
      ),
  storage_path text not null
    constraint report_attachments_storage_path_check
      check (
        length(btrim(storage_path)) between 1 and 1024
        and storage_path !~ '(^/|//|\.\.?(/|$)|[[:cntrl:]])'
      ),
  original_filename text not null
    constraint report_attachments_original_filename_check
      check (
        length(btrim(original_filename)) between 1 and 255
        and original_filename !~ '[/\\[:cntrl:]]'
      ),
  mime_type text not null
    constraint report_attachments_mime_type_check
      check (
        mime_type in (
          'text/plain',
          'text/markdown',
          'application/json',
          'application/pdf',
          'image/png',
          'image/jpeg',
          'image/webp'
        )
      ),
  size_bytes bigint not null
    constraint report_attachments_size_bytes_check
      check (size_bytes between 1 and 10485760),
  checksum_sha256 text
    constraint report_attachments_checksum_sha256_check
      check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  -- The row is created before the client uploads, so a row on its own does not mean the object
  -- exists. Only 'uploaded' rows may be listed or downloaded.
  upload_status text not null default 'pending'
    constraint report_attachments_upload_status_check
      check (upload_status in ('pending', 'uploaded', 'failed')),
  uploaded_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  constraint report_attachments_storage_object_key
    unique (storage_bucket, storage_path),
  constraint report_attachments_upload_state_check
    check ((upload_status = 'uploaded') = (uploaded_at is not null)),
  constraint report_attachments_uploaded_at_check
    check (uploaded_at is null or uploaded_at >= created_at)
);

comment on table public.report_attachments is
  'Stores private bucket/object identifiers only. Public or signed URLs must never be persisted.';

comment on column public.report_attachments.upload_status is
  'pending rows are retryable placeholders. The attachment cleanup job removes stale pending rows.';

create index report_attachments_pending_created_at_idx
  on public.report_attachments (created_at)
  where upload_status = 'pending';

alter table public.report_attachments enable row level security;
