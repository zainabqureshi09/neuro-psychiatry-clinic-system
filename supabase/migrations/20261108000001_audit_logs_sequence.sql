-- ==============================================================================
-- NPCS Psychiatry EMR & Clinical Practice System
-- PostgreSQL Migration: 20261108000001_audit_logs_sequence.sql
--
-- PURPOSE
--   Formalizes `public.audit_logs_seq` in version-controlled SQL migrations so
--   atomic `LOG-XXXX` identifier generation in `lib/db/repositories/auditRepository.ts`
--   never relies on runtime DDL (`CREATE SEQUENCE` in application code).
--
-- PROPERTIES
--   1. ADDITIVE & IDEMPOTENT: Uses `CREATE SEQUENCE IF NOT EXISTS` and safe
--      forward-only synchronization. Safe to run on fresh databases or existing
--      environments where `public.audit_logs_seq` already exists.
--   2. NO REWIND / NO COLLISION: Advances the sequence to
--      `GREATEST(current_sequence_last_value, max_existing_audit_log_id, 8900)`
--      with `is_called = true`, ensuring the next `nextval('public.audit_logs_seq')`
--      always returns strictly `> max_existing_id` and `>= 8901`, and NEVER
--      rewinds an already-advanced sequence even if `audit_logs` is empty.
--   3. LEAST PRIVILEGE: Revokes all privileges on `public.audit_logs_seq` from
--      `PUBLIC`, `anon`, and `authenticated`, and grants `USAGE, SELECT, UPDATE`
--      exclusively to `service_role` (and sequence owner `postgres`).
--
-- HOW TO APPLY (After Owner Approval)
--   Supabase Dashboard -> SQL Editor -> paste this file -> Run.
--   Or: psql "$DATABASE_URL" -f supabase/migrations/20261108000001_audit_logs_sequence.sql
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. Create the sequence if it does not already exist
-- ==============================================================================
CREATE SEQUENCE IF NOT EXISTS public.audit_logs_seq
  AS bigint
  INCREMENT BY 1
  MINVALUE 1
  NO MAXVALUE
  START WITH 8901
  CACHE 1;

-- ==============================================================================
-- 2. Forward-only synchronization (never rewinds or overwrites existing IDs)
-- ==============================================================================
DO $$
DECLARE
  v_seq_last_value bigint := 8900;
  v_max_table_id   bigint := 8900;
  v_target_val     bigint := 8900;
BEGIN
  -- Read current sequence state if already called
  SELECT COALESCE(last_value, 8900)
    INTO v_seq_last_value
    FROM pg_sequences
   WHERE schemaname = 'public'
     AND sequencename = 'audit_logs_seq';

  -- Read highest numeric suffix from existing `LOG-<number>` rows in public.audit_logs
  IF EXISTS (
    SELECT 1
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'audit_logs'
  ) THEN
    SELECT COALESCE(
             MAX(NULLIF(regexp_replace(log_id, '^LOG-', ''), '')::bigint),
             8900
           )
      INTO v_max_table_id
      FROM public.audit_logs
     WHERE log_id ~ '^LOG-[0-9]+$';
  END IF;

  v_target_val := GREATEST(v_seq_last_value, v_max_table_id, 8900);

  -- Set sequence to v_target_val with is_called = true so nextval() returns v_target_val + 1
  PERFORM setval('public.audit_logs_seq', v_target_val, true);
END
$$;

-- ==============================================================================
-- 3. Lock down sequence privileges (match RLS hardening from 20261103000001)
-- ==============================================================================
REVOKE ALL ON SEQUENCE public.audit_logs_seq FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SEQUENCE public.audit_logs_seq FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SEQUENCE public.audit_logs_seq FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.audit_logs_seq TO service_role;
  END IF;
END
$$;

COMMIT;

