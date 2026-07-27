-- DB-007: Private report discussion with audit-preserving soft deletion.

create table public.report_comments (
  id uuid default gen_random_uuid()
    constraint report_comments_pkey primary key,
  report_id uuid not null
    constraint report_comments_report_id_fkey
      references public.reports (id) on delete restrict,
  author_id uuid not null
    constraint report_comments_author_id_fkey
      references public.profiles (id) on delete restrict,
  body text not null
    constraint report_comments_body_not_blank_check
      check (length(btrim(body)) > 0),
  deleted_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint report_comments_deleted_at_check
    check (deleted_at is null or deleted_at >= created_at)
);

comment on column public.report_comments.deleted_at is
  'Soft deletion hides content at the API boundary while retaining the author and audit timestamps.';

create trigger report_comments_set_updated_at
before update on public.report_comments
for each row
execute function public.set_updated_at();

alter table public.report_comments enable row level security;
