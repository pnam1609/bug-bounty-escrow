-- RLS-001: Self-readable profiles with column-restricted client updates.

alter table public.profiles force row level security;

create policy profiles_select_self
on public.profiles
for select
to authenticated
using (id = auth.uid());

create policy profiles_update_self
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, wallet_address, avatar_url) on public.profiles to authenticated;
