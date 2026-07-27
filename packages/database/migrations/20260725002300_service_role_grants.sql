-- Table access for the API's server-side identity.
--
-- The API reads through `.from()` and writes through SECURITY DEFINER RPCs, both as `service_role`.
-- The RPC grants are declared in 20260725002100; the table grants were not — they lived only in the
-- PGlite test bootstrap (`verify-offchain.mjs`), so every test passed while a real deployment had a
-- service role that could execute the functions but not read a single row.
--
-- Supabase papers over this in its own tooling: `pg_default_acl` grants service_role everything for
-- objects created by `supabase_admin`. A migration runner connects as `postgres`, so those defaults
-- never fire and `select` on `public.programs` fails with 42501. Declaring the grants here makes the
-- result identical on Supabase, on bare PostgreSQL and in CI, whoever applies them.
--
-- This is not a widening of the security boundary. `service_role` already bypasses RLS by design;
-- what protects the data is that the key is server-side only and that money moves exclusively
-- through the settlement RPCs. RLS remains the boundary for `anon` and `authenticated`, whose grants
-- are deliberately narrow and are left untouched here.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

-- Tables added by later migrations would otherwise miss the grant above, which only covers what
-- exists right now. This keeps the two in step without a second grant statement per migration.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
