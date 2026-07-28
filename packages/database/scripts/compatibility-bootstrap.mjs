/**
 * Minimal Supabase-compatible objects for migration tests and bare PostgreSQL targets.
 *
 * This lives in a dependency-free module so the production migration image only needs `pg`;
 * importing the local demo reset would otherwise pull PGlite and bcrypt into production.
 */
export const compatibilityBootstrap = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (
    id uuid primary key,
    email text,
    encrypted_password text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid()
  returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets (id),
    name text not null, owner_id text,
    created_at timestamp with time zone not null default now()
  );
  alter table storage.objects enable row level security;
`;
