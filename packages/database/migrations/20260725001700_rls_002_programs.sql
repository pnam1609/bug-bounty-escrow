-- RLS-002: Publicly listed programs and owner/assigned-reviewer private access.
--
-- "Publicly listed" is programs.public_status is not null, i.e. active, expired or closed.
-- Ended programs stay readable so researchers can review past scope and payouts; draft,
-- awaiting_funding and paused programs remain private to the owner and assigned reviewers.

create table public.program_reviewers (
  program_id uuid not null
    constraint program_reviewers_program_id_fkey
      references public.programs (id) on delete cascade,
  reviewer_id uuid not null
    constraint program_reviewers_reviewer_id_fkey
      references public.profiles (id) on delete restrict,
  assigned_by uuid
    constraint program_reviewers_assigned_by_fkey
      references public.profiles (id) on delete set null,
  created_at timestamp with time zone not null default now(),
  constraint program_reviewers_pkey primary key (program_id, reviewer_id)
);

alter table public.program_reviewers enable row level security;
alter table public.program_reviewers force row level security;

create or replace function public.is_program_owner(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.programs
    where id = target_program_id
      and owner_id = auth.uid()
  );
$$;

create or replace function public.is_program_reviewer(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.program_reviewers
    where program_id = target_program_id
      and reviewer_id = auth.uid()
  );
$$;

create or replace function public.is_program_readable(target_program_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.programs
    where id = target_program_id
      and (
        public_status is not null
        or owner_id = auth.uid()
        or public.is_program_reviewer(id)
      )
  );
$$;

revoke all on function public.is_program_owner(uuid) from public;
revoke all on function public.is_program_reviewer(uuid) from public;
revoke all on function public.is_program_readable(uuid) from public;
grant execute on function public.is_program_owner(uuid) to anon, authenticated;
grant execute on function public.is_program_reviewer(uuid) to anon, authenticated;
grant execute on function public.is_program_readable(uuid) to anon, authenticated;

alter table public.programs force row level security;
alter table public.program_scopes force row level security;
alter table public.program_reward_tiers force row level security;
alter table public.program_tags force row level security;
alter table public.program_resources force row level security;
alter table public.program_impacts force row level security;
alter table public.program_prohibited_activities force row level security;

create policy programs_select_public_or_permitted
on public.programs
for select
to anon, authenticated
using (
  public_status is not null
  or owner_id = auth.uid()
  or public.is_program_reviewer(id)
);

create policy programs_insert_owner
on public.programs
for insert
to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'owner'
  )
);

create policy programs_update_owner
on public.programs
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- Child tables of a program all share the same readability rule.
create policy program_scopes_select_readable
on public.program_scopes
for select
to anon, authenticated
using (public.is_program_readable(program_id));

create policy program_scopes_write_owner
on public.program_scopes
for all
to authenticated
using (public.is_program_owner(program_id))
with check (public.is_program_owner(program_id));

create policy program_reward_tiers_select_readable
on public.program_reward_tiers
for select
to anon, authenticated
using (public.is_program_readable(program_id));

create policy program_reward_tiers_write_owner
on public.program_reward_tiers
for all
to authenticated
using (public.is_program_owner(program_id))
with check (public.is_program_owner(program_id));

create policy program_tags_select_readable
on public.program_tags
for select
to anon, authenticated
using (public.is_program_readable(program_id));

create policy program_tags_write_owner
on public.program_tags
for all
to authenticated
using (public.is_program_owner(program_id))
with check (public.is_program_owner(program_id));

create policy program_resources_select_readable
on public.program_resources
for select
to anon, authenticated
using (public.is_program_readable(program_id));

create policy program_resources_write_owner
on public.program_resources
for all
to authenticated
using (public.is_program_owner(program_id))
with check (public.is_program_owner(program_id));

create policy program_impacts_select_readable
on public.program_impacts
for select
to anon, authenticated
using (public.is_program_readable(program_id));

create policy program_impacts_write_owner
on public.program_impacts
for all
to authenticated
using (public.is_program_owner(program_id))
with check (public.is_program_owner(program_id));

create policy program_prohibited_activities_select_readable
on public.program_prohibited_activities
for select
to anon, authenticated
using (public.is_program_readable(program_id));

create policy program_prohibited_activities_write_owner
on public.program_prohibited_activities
for all
to authenticated
using (public.is_program_owner(program_id))
with check (public.is_program_owner(program_id));

create policy program_reviewers_select_permitted
on public.program_reviewers
for select
to authenticated
using (
  reviewer_id = auth.uid()
  or public.is_program_owner(program_id)
);

create policy program_reviewers_write_owner
on public.program_reviewers
for all
to authenticated
using (public.is_program_owner(program_id))
with check (public.is_program_owner(program_id));

revoke all on
  public.programs,
  public.program_scopes,
  public.program_reward_tiers,
  public.program_tags,
  public.program_resources,
  public.program_impacts,
  public.program_prohibited_activities,
  public.program_reviewers
from anon, authenticated;

grant select on
  public.programs,
  public.program_scopes,
  public.program_reward_tiers,
  public.program_tags,
  public.program_resources,
  public.program_impacts,
  public.program_prohibited_activities
to anon, authenticated;

grant insert on public.programs to authenticated;
-- Pool columns are intentionally absent: only SECURITY DEFINER settlement RPCs may move money.
grant update (
  name,
  slug,
  short_summary,
  description,
  website_url,
  logo_storage_path,
  status,
  deadline,
  poc_policy,
  poc_policy_note,
  reward_policy,
  testing_restrictions,
  submission_acknowledgment,
  allow_custom_impact,
  total_paid_visibility,
  updated_at
) on public.programs to authenticated;

grant insert, update, delete on
  public.program_scopes,
  public.program_reward_tiers,
  public.program_tags,
  public.program_resources,
  public.program_impacts,
  public.program_prohibited_activities
to authenticated;

grant select, insert, delete on public.program_reviewers to authenticated;
