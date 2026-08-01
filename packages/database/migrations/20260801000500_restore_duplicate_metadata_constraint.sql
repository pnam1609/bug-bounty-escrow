-- DATA-002: Restore the strict duplicate review metadata invariant after hosted demo cleanup.
--
-- This is separate from RR-FLOW-005 because the compatibility constraint may already have been
-- applied on a hosted database. It makes the final state strict on both upgraded and clean DBs.

update public.report_reviews review
set metadata = jsonb_build_object('originalReportId', mapping.original_report_id::text)
from (
  values
    ('35000000-0000-4000-8000-000000000007'::uuid, '33000000-0000-4000-8000-000000000014'::uuid),
    ('35000000-0000-4000-8000-000000000015'::uuid, '33000000-0000-4000-8000-000000000001'::uuid),
    ('35000000-0000-4000-8000-000000000023'::uuid, '33000000-0000-4000-8000-000000000002'::uuid),
    ('35000000-0000-4000-8000-000000000031'::uuid, '33000000-0000-4000-8000-000000000003'::uuid),
    ('35000000-0000-4000-8000-000000000039'::uuid, '33000000-0000-4000-8000-000000000004'::uuid),
    ('35000000-0000-4000-8000-000000000047'::uuid, '33000000-0000-4000-8000-000000000041'::uuid),
    ('35000000-0000-4000-8000-000000000055'::uuid, '33000000-0000-4000-8000-000000000041'::uuid)
) as mapping(review_id, original_report_id)
where review.id = mapping.review_id
  and review.action = 'mark_duplicate'
  and review.metadata @> '{"demo": true}'::jsonb;

alter table public.report_reviews
  drop constraint if exists report_reviews_duplicate_metadata_check;

alter table public.report_reviews
  add constraint report_reviews_duplicate_metadata_check check (
    action is distinct from 'mark_duplicate'
    or (
      metadata is not null
      and coalesce(metadata ? 'originalReportId', false)
      and coalesce(
        (metadata->>'originalReportId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        false
      )
    )
  );
