\set ON_ERROR_STOP on

-- Run only against a fresh disposable Supabase PostgreSQL database.
\ir ../../migrations/20260725000100_db_001_profiles.sql
\ir ../../migrations/20260725000200_db_002_programs.sql
\ir ../../migrations/20260725000300_db_003_program_scopes.sql
\ir ../../migrations/20260725000400_db_004_program_reward_tiers.sql
\ir verify_core_schema.sql
