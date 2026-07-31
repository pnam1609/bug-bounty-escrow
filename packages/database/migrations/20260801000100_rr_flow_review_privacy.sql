-- RR-FLOW-002/005: keep internal review rows on the program side.
--
-- `report_reviews` contains reviewer_id, transition reasons and duplicate metadata. The API uses
-- the service role and redacts those fields for researchers, but authenticated Supabase clients
-- can also read the table (for example via Realtime/PostgREST). A researcher must not bypass the
-- API projection and read internal reviewer identity or private review notes.

drop policy if exists report_reviews_select_participant on public.report_reviews;

create policy report_reviews_select_program_side
on public.report_reviews
for select
to authenticated
using (
  exists (
    select 1
    from public.reports report
    where report.id = report_reviews.report_id
      and (
        public.is_program_owner(report.program_id)
        or public.is_program_reviewer(report.program_id)
      )
  )
);

comment on policy report_reviews_select_program_side on public.report_reviews is
  'Internal review identity, notes and duplicate metadata are visible only to the program owner or assigned reviewer; researcher projections stay aggregate/API-redacted.';

-- Pending rows are upload-retry placeholders, not attachments. Do not expose their metadata to
-- direct authenticated table/Realtime reads; the API still uses the service role for the upload
-- lifecycle and explicitly filters uploaded rows in its report projection.
drop policy if exists report_attachments_select_participant on public.report_attachments;

create policy report_attachments_select_uploaded_participant
on public.report_attachments
for select
to authenticated
using (
  upload_status = 'uploaded'
  and public.can_access_report(report_id)
);

comment on policy report_attachments_select_uploaded_participant on public.report_attachments is
  'Only completed uploads are visible to authorized report participants; pending/failed rows remain retry placeholders.';

-- Storage object reads must follow the same lifecycle boundary. A signed upload creates the object
-- before the completion RPC flips metadata to uploaded; without this guard, an authorized report
-- participant could read a pending object directly through Storage RLS.
drop policy if exists report_attachments_objects_select on storage.objects;

create policy report_attachments_objects_select_uploaded
on storage.objects
for select
to authenticated
using (
  bucket_id = 'report-attachments'
  and public.storage_report_id(name) is not null
  and exists (
    select 1
    from public.report_attachments attachment
    where attachment.report_id = public.storage_report_id(name)
      and attachment.storage_bucket = bucket_id
      and attachment.storage_path = name
      and attachment.upload_status = 'uploaded'
      and public.can_access_report(attachment.report_id)
  )
);

comment on policy report_attachments_objects_select_uploaded on storage.objects is
  'Private report objects are readable only after their metadata row reaches uploaded; pending objects remain write-only.';
