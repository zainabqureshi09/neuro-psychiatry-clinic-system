-- ==============================================================================
-- NPCS Psychiatry EMR & Clinical Practice System
-- PostgreSQL Migration: 20261103000001_npcs_rls_and_integrity_hardening.sql
--
-- PURPOSE
--   Closes two security/data-integrity gaps found during the pre-deployment
--   audit. This migration is ADDITIVE and SAFE: it never drops a table, never
--   deletes a row, and never alters a column.
--
-- GAP 1 - Patient data was reachable directly from the browser
--   The initial schema created 13 tables in the `public` schema WITHOUT Row
--   Level Security. Supabase publishes every `public` table over its REST API
--   (PostgREST) and grants the `anon` / `authenticated` roles access by
--   default. Because the app ships NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to the
--   browser, anyone holding that key could read and write every patient,
--   consultation, prescription and payment - completely bypassing this
--   application's JWT + role-based access control.
--
--   FIX: enable RLS on all 13 tables with ZERO policies (deny-by-default), and
--   revoke the table privileges Supabase auto-grants to `anon` /
--   `authenticated`. The server-side application is unaffected because it
--   connects with the SECRET key, which maps to the `service_role` and
--   BYPASSES Row Level Security. No application code needs to change.
--
-- GAP 2 - A hard DELETE of a patient could destroy clinical history
--   `clinical_records`, `appointments` and `follow_ups` referenced `patients`
--   with ON DELETE CASCADE. The application only ever soft-deletes patients
--   (is_active = false, status = 'Discharged'), so this was latent - but a
--   single stray `DELETE FROM patients` would have silently wiped all related
--   clinical records. Those three constraints are now ON DELETE RESTRICT, so
--   the database itself refuses to orphan or destroy clinical data.
--
-- HOW TO APPLY
--   Supabase Dashboard -> SQL Editor -> paste this file -> Run.
--   Or: psql "$DATABASE_URL" -f 20261103000001_npcs_rls_and_integrity_hardening.sql
--
-- REVERSIBILITY
--   See the "ROLLBACK" block at the bottom of this file.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- 1. Enable Row Level Security on every clinical / administrative table
--
-- With RLS enabled and no policies defined, ALL access from `anon` and
-- `authenticated` is denied. `service_role` (used by this application) bypasses
-- RLS entirely, so reads and writes from the Express backend and the Next.js
-- route handlers continue to work exactly as before.
-- ==============================================================================
ALTER TABLE IF EXISTS users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS patients         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS clinical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS fee_categories   ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS consultations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS prescriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS appointments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS follow_ups       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS therapy_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_logs       ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS backup_logs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS clinic_settings  ENABLE ROW LEVEL SECURITY;

-- Defence in depth (OPTIONAL - disabled by default).
--
-- FORCE makes RLS apply even to the table owner. Supabase's own `postgres` and
-- `service_role` roles hold BYPASSRLS, so they are unaffected either way - the
-- application will keep working whether or not these lines are enabled.
--
-- They are left commented out on purpose: if your project ever connects with a
-- NON-superuser role that owns these tables, enabling FORCE would immediately
-- block that role. Enable only after confirming your connection role holds
-- BYPASSRLS (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user;).
--
-- ALTER TABLE users            FORCE ROW LEVEL SECURITY;
-- ALTER TABLE patients         FORCE ROW LEVEL SECURITY;
-- ALTER TABLE clinical_records FORCE ROW LEVEL SECURITY;
-- ALTER TABLE fee_categories   FORCE ROW LEVEL SECURITY;
-- ALTER TABLE consultations    FORCE ROW LEVEL SECURITY;
-- ALTER TABLE prescriptions    FORCE ROW LEVEL SECURITY;
-- ALTER TABLE appointments     FORCE ROW LEVEL SECURITY;
-- ALTER TABLE follow_ups       FORCE ROW LEVEL SECURITY;
-- ALTER TABLE therapy_sessions FORCE ROW LEVEL SECURITY;
-- ALTER TABLE payments         FORCE ROW LEVEL SECURITY;
-- ALTER TABLE audit_logs       FORCE ROW LEVEL SECURITY;
-- ALTER TABLE backup_logs      FORCE ROW LEVEL SECURITY;
-- ALTER TABLE clinic_settings  FORCE ROW LEVEL SECURITY;

-- ==============================================================================
-- 2. Revoke the table privileges Supabase auto-grants to the public API roles
--
-- Supabase grants `anon` and `authenticated` access to every table in the
-- `public` schema. RLS now denies their rows, and this additionally removes the
-- privilege itself - so even a future change to RLS cannot silently re-expose
-- clinical data through the public REST API.
--
-- `service_role` (the secret key used by the server) is NOT touched.
-- Guarded with role-existence checks so this file also runs on a plain
-- PostgreSQL instance used for local testing.
-- ==============================================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon;
        REVOKE USAGE ON SCHEMA public FROM anon;
        RAISE NOTICE 'Revoked public-schema privileges from role: anon';
    ELSE
        RAISE NOTICE 'Role anon not present (non-Supabase database) - skipped.';
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM authenticated;
        REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
        REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;
        RAISE NOTICE 'Revoked public-schema privileges from role: authenticated';
    ELSE
        RAISE NOTICE 'Role authenticated not present (non-Supabase database) - skipped.';
    END IF;

    -- Prevent the same exposure from being re-created on tables added later.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM anon;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon;
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES    FROM authenticated;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM authenticated;
    END IF;
END $$;

-- ==============================================================================
-- 3. Stop a hard DELETE of a patient from destroying clinical history
--
-- The application only soft-deletes patients (is_active = false,
-- status = 'Discharged'), so these constraints are never exercised in normal
-- operation. They exist purely to make accidental data loss impossible at the
-- database level.
--
-- NOTE: ADD CONSTRAINT re-validates existing rows. If the table already
-- contains orphaned rows the whole migration rolls back cleanly (see the
-- pre-check query in the ROLLBACK section below).
-- ==============================================================================
ALTER TABLE clinical_records DROP CONSTRAINT IF EXISTS clinical_records_patient_id_fkey;
ALTER TABLE clinical_records ADD  CONSTRAINT clinical_records_patient_id_fkey
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_patient_id_fkey;
ALTER TABLE appointments ADD  CONSTRAINT appointments_patient_id_fkey
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;

ALTER TABLE follow_ups DROP CONSTRAINT IF EXISTS follow_ups_patient_id_fkey;
ALTER TABLE follow_ups ADD  CONSTRAINT follow_ups_patient_id_fkey
    FOREIGN KEY (patient_id) REFERENCES patients(patient_id)
    ON UPDATE CASCADE ON DELETE RESTRICT;


-- ==============================================================================
-- 4. Self-verification: fail loudly if any table is still unprotected
-- ==============================================================================
DO $$
DECLARE
    insecure TEXT;
BEGIN
    SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
      INTO insecure
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname IN (
            'users', 'patients', 'clinical_records', 'fee_categories',
            'consultations', 'prescriptions', 'appointments', 'follow_ups',
            'therapy_sessions', 'payments', 'audit_logs', 'backup_logs',
            'clinic_settings'
       )
       AND NOT c.relrowsecurity;

    IF insecure IS NOT NULL THEN
        RAISE EXCEPTION
            'RLS hardening FAILED - Row Level Security is still disabled on: %', insecure;
    END IF;

    RAISE NOTICE 'RLS hardening verified: all 13 NPCS tables are protected.';
END $$;

COMMIT;



-- ==============================================================================
-- ROLLBACK (only if you deliberately need to reverse this migration)
--
--   BEGIN;
--   -- revert the three foreign keys to their original ON DELETE behaviour:
--   ALTER TABLE clinical_records DROP CONSTRAINT clinical_records_patient_id_fkey;
--   ALTER TABLE clinical_records ADD  CONSTRAINT clinical_records_patient_id_fkey
--       FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE CASCADE;
--   ALTER TABLE appointments DROP CONSTRAINT appointments_patient_id_fkey;
--   ALTER TABLE appointments ADD  CONSTRAINT appointments_patient_id_fkey
--       FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE CASCADE;
--   ALTER TABLE follow_ups DROP CONSTRAINT follow_ups_patient_id_fkey;
--   ALTER TABLE follow_ups ADD  CONSTRAINT follow_ups_patient_id_fkey
--       FOREIGN KEY (patient_id) REFERENCES patients(patient_id) ON UPDATE CASCADE ON DELETE CASCADE;
--   -- disable RLS again:
--   ALTER TABLE users            DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE patients         DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE clinical_records DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE fee_categories   DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE consultations    DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE prescriptions    DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE appointments     DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE follow_ups       DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE therapy_sessions DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE payments         DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE audit_logs       DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE backup_logs      DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE clinic_settings  DISABLE ROW LEVEL SECURITY;
--   COMMIT;
--
-- WARNING: rolling back re-exposes clinical data to the public API. Only do it
-- if the publishable key has been rotated and is not distributed to browsers.
-- ==============================================================================

-- ==============================================================================
-- PRE-CHECK (safe, read-only). Run BEFORE applying and expect every count = 0.
-- Any non-zero count means orphaned rows exist and the FK step would fail
-- (the whole transaction would roll back, leaving the database untouched).
--
--   SELECT 'clinical_records' AS tbl, COUNT(*) FROM clinical_records c
--     LEFT JOIN patients p ON p.patient_id = c.patient_id WHERE p.patient_id IS NULL
--   UNION ALL
--   SELECT 'appointments', COUNT(*) FROM appointments a
--     LEFT JOIN patients p ON p.patient_id = a.patient_id WHERE p.patient_id IS NULL
--   UNION ALL
--   SELECT 'follow_ups', COUNT(*) FROM follow_ups f
--     LEFT JOIN patients p ON p.patient_id = f.patient_id WHERE p.patient_id IS NULL;
-- ==============================================================================

-- ==============================================================================
-- POST-CHECK (safe, read-only). Run AFTER applying. Expect 13 rows, each with
-- relrowsecurity = true.
--
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
--      AND relname IN ('users','patients','clinical_records','fee_categories',
--                      'consultations','prescriptions','appointments','follow_ups',
--                      'therapy_sessions','payments','audit_logs','backup_logs',
--                      'clinic_settings')
--    ORDER BY relname;
-- ==============================================================================

