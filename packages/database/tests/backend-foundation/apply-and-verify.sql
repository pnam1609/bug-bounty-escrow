\set ON_ERROR_STOP on

-- Run only against a fresh disposable Supabase PostgreSQL database.
\ir ../../migrations/20260725000100_db_001_profiles.sql
\ir ../../migrations/20260725000200_db_002_programs.sql
\ir ../../migrations/20260725000300_db_003_program_scopes.sql
\ir ../../migrations/20260725000400_db_004_program_reward_tiers.sql
\ir ../../migrations/20260725000410_db_004b_program_taxonomy.sql
\ir ../../migrations/20260725000500_db_005_reports.sql
\ir ../../migrations/20260725000550_db_005b_report_impacts.sql
\ir ../../migrations/20260725000560_db_005c_report_disclosures.sql
\ir ../../migrations/20260725000600_db_006_report_attachments.sql
\ir ../../migrations/20260725000700_db_007_report_comments.sql
\ir ../../migrations/20260725000800_db_008_report_reviews.sql
\ir ../../migrations/20260725000900_db_009_ai_triage_results.sql
\ir ../../migrations/20260725001000_db_010_escrow_contracts.sql
\ir ../../migrations/20260725001100_db_011_escrow_transactions.sql
\ir ../../migrations/20260725001200_db_012_notifications.sql
\ir ../../migrations/20260725001300_db_013_audit_logs.sql
\ir ../../migrations/20260725001400_db_014_indexes_and_constraints.sql
\ir verify_schema.sql
