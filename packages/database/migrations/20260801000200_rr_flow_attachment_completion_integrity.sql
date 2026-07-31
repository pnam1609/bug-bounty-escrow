-- RR-FLOW-002/005: prove an attachment object exists before exposing it as uploaded.
--
-- The signed upload URL creates a pending metadata row before the client uploads. Completion is
-- allowed to promote that row only after the canonical private Storage object exists. This keeps
-- report projections from listing phantom attachments and keeps download signing fail-closed.

create or replace function public.complete_report_attachment_atomic(
  actor_id uuid,
  target_report_id uuid,
  attachment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  attachment_record public.report_attachments;
begin
  select * into attachment_record
  from public.report_attachments
  where id = attachment_id
    and report_id = target_report_id
    and uploader_id = actor_id
  for update;

  if not found or attachment_record.upload_status <> 'pending' then
    perform public.reject_forbidden('attachment_not_accessible');
  end if;

  if not exists (
    select 1
    from storage.objects storage_object
    where storage_object.bucket_id = attachment_record.storage_bucket
      and storage_object.name = attachment_record.storage_path
  ) then
    perform public.reject_business('attachment_object_missing');
  end if;

  update public.report_attachments
  set upload_status = 'uploaded', uploaded_at = now()
  where id = attachment_id;

  return attachment_id;
end;
$$;

revoke all on function public.complete_report_attachment_atomic(uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function public.complete_report_attachment_atomic(uuid, uuid, uuid) to service_role;

comment on function public.complete_report_attachment_atomic(uuid, uuid, uuid) is
  'Promotes a pending attachment only when its canonical private Storage object exists; retries are fail-closed.';
