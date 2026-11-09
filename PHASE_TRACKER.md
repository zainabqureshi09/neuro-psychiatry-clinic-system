# NPCS EMR — Phase Tracker & Deployment Record

**Project:** NPCS – Neuropsychiatric & Clinical Practice System
**Purpose:** Single source of truth for what is done, what is pending, and what must never be touched.
**Last updated:** 2026-11-08

---

## 1. Ground rules (agreed with the owner)

| # | Rule | Status |
|---|---|---|
| R1 | Do not delete or overwrite existing patient data | Enforced |
| R2 | Do not drop MongoDB collections or migrate MongoDB data (yet) | Enforced |
| R3 | Do not assume Supabase credentials are valid — verify | Enforced |
| R4 | Never expose DB credentials or service-role keys (never in chat, never in git) | Enforced |
| R5 | Do not deploy untested code | Enforced |
| R6 | Do not change the existing UI unnecessarily | Enforced |
| R7 | Do not remove existing features without explicit owner approval | Enforced |
| R8 | Git checkpoint + backup before any change | Done (see §5) |
| R9 | No VPS access / no deployment until the owner explicitly approves | Enforced |

**Approval gate:** live deployment requires owner sign-off after Phases 2–4 pass against
the real Supabase project.

---

## 2. Infrastructure (as supplied by the owner)

| Item | Value |
|---|---|
| Hosting | Contabo — Cloud VPS 4 |
| OS | Ubuntu 24.04 |
| IP | `<VPS_PUBLIC_IP>` *(redacted)* (**not accessed**) |
| Frontend | Next.js 16.3.4 |
| Backend | Node.js + Express 5.2.1 |
| Database | Supabase PostgreSQL (**project does not exist yet**) |
| Process manager | PM2 |
| Reverse proxy | Nginx |
| SSL | Let's Encrypt / Certbot |
| Production domain | ❓ **Unresolved** — `nginx/emr.conf` says `emr.yourclinicdomain.com`; CORS defaults say `npcs.digital` |

---

## 3. Phase status

| Phase | Description | Status |
|---|---|---|
| **0** | Audit, source backup, Git checkpoint | ✅ **Complete** |
| **1** | Schema security hardening (RLS, grants, FK integrity) + production secret guard | ✅ **Complete** |
| **S** | Provision + migrate the new Supabase project | ✅ **Complete** (2026-11-04) |
| **2** | Connect app to Supabase, validate credentials, transactional pool, env templates | ✅ **Complete** (2026-11-04) |
| **2b** | Express declared single authoritative API; dead Supabase scaffolding removed | ✅ **Complete** (2026-11-05) |
| **3** | Read-only MongoDB → PostgreSQL data migration (MongoDB preserved) | ⏳ Awaiting owner approval |
| **4** | Live integration & browser E2E tests against real Supabase (Playwright 10/10, Phase 2 34/34, Express 24/24) | ✅ **Complete** (2026-11-08) |
| **4b** | Pre-deployment security hardening & housekeeping (`.env.production.example`, `seedAdmin`, `LoginScreen`, TLS CA, `audit_logs_seq`) | ✅ **Complete** (2026-11-08) |
| **5** | VPS deployment (PM2, Nginx, Certbot, UFW, pg_dump backups) | ⛔ **Not approved** |

---

## 4. Completed work in detail

### Phase 0 — Audit & checkpoint ✅

* Full architecture audit: 27 Next.js route handlers, 12 Express route modules, 14 repositories.
* Verified the configured Supabase host `<old-project-ref>.supabase.co` returns **NXDOMAIN**
  from the local resolver, Google DoH, and Cloudflare DoH (control domain `supabase.co`
  resolves correctly) → **the project does not exist; the migration was never live.**
* **Correction to the Phase 0 report (measured 2026-11-03):** the application does **not**
  fall back to MongoDB. `getDatabaseConfig()` selects `postgres` whenever `SUPABASE_URL` and a
  format-valid secret are present — the *dead* host still satisfies that check — so
  `ensureDatabaseReady()` fails its DNS pre-flight and every data API returns **503**.
  The earlier statement "running in MongoDB fallback mode" was wrong. Verified with
  `scratch/check-provider.ts`: `provider = postgres`, `mongoConfigured = true` but **unused**.
  MongoDB is used only when the Supabase keys are removed or `DB_PROVIDER=mongodb` is set.
* Confirmed 13 Mongoose models ↔ 13 PostgreSQL tables.
* Baseline gates: `tsc --noEmit` ✅ · `eslint` ✅ · `next build` ✅ · `test:postgres` **39/39** ✅.
* Source backup: `…/backups/npcs-source-20261103-234956.tar.gz` (2.36 MB).
* Git checkpoint commit + annotated tag `pre-supabase-integration`.
* Added `scratch/` and `scratch2_*.txt` to `.gitignore` so debug dumps are never committed.

### Phase 1 — Security hardening ✅

New migration: `supabase/migrations/20261103000001_npcs_rls_and_integrity_hardening.sql`

* Enabled Row Level Security on all 13 tables (previously **0 of 13**). With no policies
  this is deny-by-default for the public API roles.
* Revoked `anon` and `authenticated` privileges on all public-schema tables, sequences and
  functions; revoked `USAGE` on schema `public` from `anon`.
* `ALTER DEFAULT PRIVILEGES` so future tables are not auto-exposed.
* Changed 3 foreign keys from `ON DELETE CASCADE` → `ON DELETE RESTRICT`
  (`clinical_records`, `appointments`, `follow_ups` → `patients`).
* Self-verifying `DO` block that raises an exception if any table is left unprotected.
* `lib/auth.ts`: production now rejects a missing/short/placeholder `SESSION_SECRET`
  (previously it silently fell back to a hardcoded development string).
* `scripts/validateSchema.ts` extended with a **54-check** offline validator
  (`npm run validate:schema`).
* No table dropped, no row deleted, no UI or feature changed.

**Why RLS mattered:** Supabase publishes every `public` table over its REST API, and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ships to the browser. With RLS disabled, anyone
holding that key could read/write every patient, consultation, prescription and payment
while bypassing the app's JWT + RBAC. The server is unaffected by the fix because the
secret key maps to `service_role`, which bypasses RLS.

### Phase S — Supabase provisioning 🔄

| Check | Result |
|---|---|
| Project host created | ✅ Resolves (2 A records via local resolver **and** Google DoH) |
| Project live | ✅ `GET /auth/v1/health` → **HTTP 200** |
| Publishable key valid | ✅ Accepted by PostgREST (otherwise HTTP 401) |
| `public` schema state | ✅ **Empty** — `GET /rest/v1/patients` → `PGRST205` "Could not find the table" |
| Migrations applied | ✅ **Done 2026-11-04** — File 1 + File 2 applied via `npm run apply:supabase -- --apply` (exit 0) |

**Post-migration verification (independent queries, not the runner's own report):**

| Check | Result |
|---|---|
| Tables | **13 / 13** |
| Indexes (incl. PK/UNIQUE) | 60 — 34 explicit `CREATE INDEX` + PK/unique constraints |
| Triggers | 18 catalog rows for 15 trigger objects |
| Functions | 5 |
| RLS enabled | **13 / 13** |
| `clinic_settings` seed | 1 row → *Neuro Psychiatry Clinic / DR SHAHAB MUHAMMAD* |
| FK `ON DELETE` | 11 × `RESTRICT`, 1 × `SET NULL` (payments→fee_categories). The 3 former `CASCADE` rules are now `RESTRICT` |
| `anon` / `authenticated` grants | `SELECT=false`, `INSERT=false` on every table |
| REST probe (publishable key) | `patients`, `payments`, `users` → **HTTP 401 · code `42501` (insufficient_privilege)** |

| Secret key installed | ⛔ Pending (must never be shared in chat) |
| DB credentials verified | ✅ 2026-11-04 — session pooler accepted; `db=postgres user=postgres`; **PostgreSQL 17.11** (aarch64) |
| TLS note | Supabase pooler cert is signed by a CA Node does not trust → `sslmode=require` fails with "self-signed certificate in certificate chain". The migration runner uses `sslmode=no-verify` (still TLS-encrypted). Production should install the project CA and use `verify-full`. |
| Direct DB connection `db.<ref>:5432` | ⚠️ **IPv6-only** (AAAA `2406:da1c:…`, **no** IPv4 A record). The dev PC holds no global IPv6 address, so TCP 5432 is unreachable from here. Use the **Session pooler** (IPv4) for `DATABASE_URL`. |
| Session pooler `aws-0-<region>.pooler.supabase.com` | ✅ IPv4 (<pooler-ip-1> · <pooler-ip-2> · <pooler-ip-3>). TCP **5432 reachable**, TCP 6543 reachable |
| Project region | **ap-southeast-2 (Sydney)** — permanent after creation; factor into latency when sizing the VPS |

The old host `<old-project-ref>.supabase.co` remains dead; the new project replaces it.
Access values live only in the git-ignored `.env.local`.

**Ordering rule (safety-critical):** File 1 creates 13 tables *without* RLS. Until File 2
runs, those tables are readable through the public REST API by anyone holding the
publishable key. Both files must be applied back-to-back, and **no real patient data may be
loaded before File 2 completes.**

**Step order (revised):** migrations are applied **before** `.env.local` is repointed.
The SQL Editor runs independently of the app, so doing it first avoids a window in which the
app is switched to PostgreSQL but the tables do not exist yet.

**Configuration trap:** the provider switches to PostgreSQL as soon as `SUPABASE_URL` and a
format-valid `SUPABASE_SECRET_KEY` are both present. If the new URL is paired with the *old*
project's secret key, the app will attempt every request against the new project using a
foreign key and fail with 401. The URL and the secret key must always be replaced in the
same edit.
### Phase 2 — Live connection & integration ✅

Executed by `npm run test:phase2` (`scripts/testPhase2Live.ts`), which writes
`scratch/phase2-report.txt`. **Result: 34 passed, 0 failed, 0 skipped.**

| Area | Checks | Result |
|---|---|---|
| A. Credentials | URL, format check, secret key accepted by PostgREST | 4/4 |
| B. Provider | `provider === 'postgres'`; `ensureDatabaseReady()` | 2/2 |
| C. Pooler | `DATABASE_URL` set, pool created, `SELECT 1`, server version | 4/4 |
| D. Transactions | COMMIT persists, ROLLBACK discards, rollback restores an UPDATE | 3/3 |
| E. Auth | bcrypt hash, accept/reject password, JWT sign+verify, expired token, `getSession`, RBAC allow + 403 | 10/10 |
| F. CRUD | patient create/search/duplicate, consultation cascade (**transactional=true**), payment + immutable-receipt trigger, audit write, settings, soft delete | 10/10 |
| G. Cleanup | only this run's rows removed; every table back to 0 | 1/1 |

**Fixes required to make this work**

* `lib/db/postgres.ts` — TLS was enabled only when `NODE_ENV === 'production'`, so development
  connections reached Supabase without TLS and were rejected. TLS is now enabled for any
  non-local host.
* `DATABASE_URL` added to `.env.local` (session pooler, port **5432**, `?sslmode=no-verify`).
  Port **6543 must never be used** — transaction pooling breaks `BEGIN/COMMIT`.
* New tooling: `npm run verify:supabase`, `npm run test:phase2`.

**Verified live facts**

* PostgreSQL **17.11** (aarch64) via `aws-0-<region>.pooler.supabase.com:5432`
* Secret key acts as `service_role` (PostgREST HTTP 200); publishable key denied (`42501`)
* Receipt-number immutability enforced by the database trigger, not only by application code
* Note: an early PowerShell probe falsely reported 401 — PS 5.1 header handling. Node `fetch`
  (the path the app actually uses) returns 200.



---

### Phase 2b — Express as the single authoritative API ✅ (2026-11-05)

**Owner decision:** Express is authoritative. Next.js API handlers are **frozen** as
non-authoritative regression references (39 offline tests exercise them) and are **not deleted**.

**Removed (owner-approved Option 1, after checkpoint tag `pre-express-authority`):**
* `app/supabase-test/page.tsx` — public unauthenticated page querying a non-existent `todos` table
* `utils/supabase/client.ts`, `utils/supabase/server.ts`, `utils/supabase/middleware.ts` — orphaned
  helpers imported by nothing else

**Gap found and fixed:** Express had **no `GET /api/reports`** — only `/collections/daily` and
`/collections/monthly`. Behind Nginx, `ReportsScreen` would have silently fallen back to placeholder
numbers. Added `getPracticeReports` (billingController) + route with the same `ADMIN`/`DOCTOR` gate,
backed by the same `getPracticeReport()` repository as the frozen Next handler.

**Frontend calls repointed to Express** (matching the existing `PatientListScreen` pattern —
Bearer token + `credentials: 'include'`):
* `components/common/GlobalSearchModal.tsx` → `${NEXT_PUBLIC_API_URL}/api/patients?q=`
* `components/screens/ReportsScreen.tsx` → `${NEXT_PUBLIC_API_URL}/api/reports`

**Live Express verification:** `npm run test:express` → **24/24 passed**
(report: `scratch/express-report.txt`). Confirms health, security headers, 401 unauthenticated,
`/api/patients?q=` (GlobalSearchModal), paginated list, `/api/reports` (ReportsScreen),
`/api/reports/collections/daily`, `/api/settings`, `/api/audit-logs`, 403 for a real THERAPIST,
CORS preflight with credentials for `localhost:3000`, login 401/200, httpOnly cookie.

**Two security findings surfaced while testing (both positive):**
1. `authenticate` resolves the user's role **from the database**, not the JWT claim — a forged
   `role` in a token cannot escalate privileges.
2. `validateRequest` rejects a malformed login payload with **400** before credential checking
   (correct: invalid input ≠ invalid credentials).

**Regression warning recorded:** audit writes are fire-and-forget, so any test that deletes audit
rows must wait for them to land (2s settle added) — otherwise rows arrive after the DELETE.

---

### Phase 4 — Browser E2E & Pre-Deployment Hardening ✅ (2026-11-08)

**Playwright Chromium E2E Suite (`npm run e2e` / `playwright.config.ts`):**
* Installed `@playwright/test` (`1.64.1`) with Chromium-only binary to preserve disk space.
* Global setup (`e2e/global-setup.ts`) seeds the 4 synthetic `@npcs.test` staff accounts and 1 synthetic patient (`E2E SYNTHETIC PATIENT`); global teardown (`e2e/global-teardown.ts`) removes all synthetic users, patients, dependent clinical rows, and audit entries after the run.
* Starts the real Express backend (`:5000`, `NODE_ENV=test`) and Next.js frontend (`:3000`) against the live Supabase database.

#### Verified E2E Test Matrix (`e2e/auth.spec.ts` + `e2e/clinical.spec.ts` — **10 / 10 passed**)

| # | Spec | Scenario | Result |
|---|---|---|---|
| 1 | `auth.spec.ts` (1) | Login with valid synthetic credentials (`POST /api/auth/login` → 200, JWT stored) | ✅ PASS |
| 2 | `auth.spec.ts` (2) | Login with invalid password refused (`401`, no token issued) | ✅ PASS |
| 3 | `auth.spec.ts` (3) | Session persists across page reload (`GET /api/auth/me` → 200) | ✅ PASS |
| 4 | `auth.spec.ts` (4) | Logout clears session (`POST /api/auth/logout` → 200, token removed) | ✅ PASS |
| 5a | `auth.spec.ts` (5a) | `ADMIN` sees admin-only navigation (`Users & Roles`, `Audit Log`) | ✅ PASS |
| 5b | `auth.spec.ts` (5b) | `THERAPIST` does not see admin-only navigation | ✅ PASS |
| 5c | `auth.spec.ts` (5c) | `RECEPTIONIST` does not see admin-only navigation | ✅ PASS |
| 6 | `clinical.spec.ts` (6) | Global patient search (`GET /api/patients?q=`) returns synthetic patient | ✅ PASS |
| 7 | `clinical.spec.ts` (7) | Creating a patient registers it (`201`) and rejects duplicate phone (`400`) | ✅ PASS |
| 8 | `clinical.spec.ts` (8) | Reports screen loads live aggregates from Express (`GET /api/reports` → 200) | ✅ PASS |

**Post-run database residue:** `{"users":0,"patients":0}` (verified by `global-teardown.ts`).

#### Pre-Deployment Security Hardening & Housekeeping ✅ (2026-11-08)

* **`backend/config/seedAdmin.ts`:** Skips auto-seeding when `NODE_ENV=test` so automated test suites manage synthetic fixtures independently. In `NODE_ENV=production`, rejects `INITIAL_ADMIN_PASSWORD` values shorter than 12 characters or matching known placeholders (`Admin@123456`, `Vance2026!`, `admin`, `password`, `12345678`, `changeMe123!`).
* **`components/screens/LoginScreen.tsx`:** Removed pre-filled demo credentials (`dr.vance@vancepsychiatry.com` / `Vance2026!`) from initial component state; updated placeholder to `doctor@clinic.com`.
* **`lib/db/postgres.ts`:** Added `SUPABASE_SSL_CA_PATH` and `SUPABASE_SSL_CA` support so production deployments can supply the Supabase Root CA and enforce `rejectUnauthorized: true`.
* **`lib/db/repositories/auditRepository.ts`:** Replaced `COUNT(*)`-based `LOG-xxxx` generation with PostgreSQL sequence `public.audit_logs_seq` (`relkind='S'`, verified in Supabase with `anon` and `authenticated` privileges `false` and `service_role` `true`). Uses forward-only `GREATEST(last_value, max_existing_log_id, 8900)` synchronization (no runtime DDL, never rewinds sequence) plus `23505` unique-violation retry with sequence resync. Verified against pre-existing colliding rows and 5-way concurrent bursts.
* **`backend/config/database.ts`:** Added `.env.production` to `loadEnvIfMissing()` search order (`[".env.production", ".env.local", ".env"]`).
* **`.env.production.example` (Task P8):** Rewritten as Supabase-first (`DB_PROVIDER=postgres`, IPv4 Session Pooler on port `5432` with warning against port `6543`, optional `SUPABASE_SSL_CA_PATH`, and zero real secrets).
* **`.gitignore`:** Added `/test-results/` and `/playwright-report/`.

---

## 5. Change log

| Commit | Tag | Summary |
|---|---|---|
| `a27ebc0` | `pre-supabase-integration` | Checkpoint: PostgreSQL repository layer, RBAC, audit, offline suite (66 files) |
| `5d8df01` | — | Security: RLS + revokes + FK hardening + production secret guard |
| `cb356bf` | — | Docs: record Phase S completion - 13 tables created, RLS verified, public API locked out |
| `5dab99e` | — | Docs: record partial P3 completion |
| `05a4a99` | `pre-express-authority` | Phase 2: live Supabase verified - provider postgres, pooler TLS fix, 34/34 integration tests |
| `0668312` | — | Phase 2b: Express as sole authoritative API; add `/api/reports`; remove dead `supabase-test` page and orphan helpers |
| `7ea37b2` | — | E2E: add verified synthetic fixture harness and document Phase 4 requirements |

Rollback: `git reset --hard pre-supabase-integration`

---

## 6. Verified migration inventory

Measured by mechanically stripping SQL comments (`scratch/audit-sql.js`), not estimated.

### File 1 — `20261026000001_initial_npcs_schema.sql` (635 lines)

| Objects created | Count |
|---|---|
| Tables (`CREATE TABLE IF NOT EXISTS`) | **13** |
| Indexes (`CREATE INDEX IF NOT EXISTS`) | **34** |
| Triggers | **15** |
| Functions | **5** |
| Extensions | **2** (`uuid-ossp`, `pgcrypto`) |
| Seed rows | **1** (`clinic_settings`, singleton `id = 1`, `ON CONFLICT DO NOTHING`) |

**Destructive statements: NONE**
(`DROP TABLE` 0 · `DROP COLUMN` 0 · `TRUNCATE` 0 · `DELETE FROM` 0 · `ALTER COLUMN TYPE` 0)

⚠️ Runs **without** a `BEGIN/COMMIT` wrapper, and its `CREATE TRIGGER` statements have no
`IF NOT EXISTS` → **apply this file exactly once, to a brand-new empty project.**
Re-running would fail at the first trigger (`already exists`), though no data would be lost.

### File 2 — `20261103000001_npcs_rls_and_integrity_hardening.sql` (259 lines)

| Action | Count |
|---|---|
| `ENABLE ROW LEVEL SECURITY` | **13** (one per table) |
| `REVOKE` statements | **13** (7 direct + 6 via default privileges) |
| `ALTER DEFAULT PRIVILEGES` | **6** |
| `ALTER TABLE … DROP CONSTRAINT IF EXISTS` | **3** |
| `ALTER TABLE … ADD CONSTRAINT` (`ON DELETE RESTRICT`) | **3** |
| `FORCE ROW LEVEL SECURITY` | **0 active** (13 lines intentionally commented out) |

**Destructive statements: NONE.** Wrapped in `BEGIN … COMMIT` → **safe to re-run.**
Includes pre-check and post-check queries plus a commented rollback block.

> **Correction to the Phase 1 report:** the index count is **34**, not 46 (my earlier figure
> was an estimate from a mixed grep). Table, trigger and function counts were verified.

---

## 7. Pending tasks & open decisions

| # | Item | Owner | Blocked by |
|---|---|---|---|
| P1 | Create the new Supabase project | Owner | ✅ Done 2026-11-03 (live, schema empty) |
| P2 | Apply File 1 then File 2 in the SQL Editor | Owner | ✅ Done 2026-11-04 (applied by agent via runner) |
| P3 | Point `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_JWKS_URL` at the new project | Agent | ✅ Done 2026-11-04 |
| P3b | Replace the `SUPABASE_SECRET_KEY` placeholder with the real secret key | Owner | ✅ Done 2026-11-04 (verified: service_role, HTTP 200) |
| P3a | Install the new project's **secret key** into `.env.local` (replaces the dead project's key) | Owner | must be done in the same edit as P3 |
| P4 | Confirm production domain + SSH access | Owner | — |
| P5 | Decide authoritative API surface (Nginx sends all `/api/` to Express; 27 Next handlers become dead in prod) | Owner | ✅ **Decided 2026-11-05: Express is authoritative.** Next handlers frozen, not deleted |
| P6 | Remove `app/supabase-test/page.tsx` + unused `utils/supabase/*` helpers | Agent | ✅ **Done 2026-11-05** (Option 1 approved) |
| P6 | Remove `app/supabase-test/page.tsx` + unused `utils/supabase/*` helpers | Needs owner OK | — |
| P7 | `DATABASE_URL` (session pooler **5432**, `?sslmode=require`) for atomic payments/booking/cascades — **never** the transaction pooler 6543, which breaks BEGIN/COMMIT | Agent | ✅ Done 2026-11-04 |
| P7a | `npm run apply:supabase` migration runner created (`scripts/applySupabaseMigrations.ts`) — dry-run by default, `--apply` to write, verifies RLS afterwards | Agent | ✅ Tool ready (untested against live DB) |
| P8 | Rewrite `.env.production.example` as Supabase-first | Agent | ✅ Done 2026-11-08 |
| P9 | Read-only MongoDB → PostgreSQL migration tool | Agent | Phase 4 |
| P10 | Supabase backup/PITR runbook + `pg_dump` cron | Agent | VPS approval |
| P11 | Create `/var/log/emr` on the VPS for PM2 | Agent | VPS approval |

---

## 8. Known risks (tracked)

| Risk | Severity | Mitigation |
|---|---|---|
| Patient records hidden if provider switches before data migration | 🔴 High | Phase 3 runs before any cutover; MongoDB kept intact |
| Non-atomic writes while `DATABASE_URL` is unset | 🟠 High | P7 adds the `pg` pool |
| Public Supabase REST access to clinical tables | 🔴 High | **Fixed** in Phase 1 (RLS + revokes) |
| Dual API surfaces drifting apart | 🟡 Medium | Shared repository layer; P5 decision pending |
| Deployment docs / backup scripts still MongoDB-only | 🟡 Medium | P8 / P10 |

---

## 9. What has NOT been done (explicit)

* No Supabase project created, connected, or queried.
* No SQL executed against any database.
* No MongoDB collection read, written, migrated, or dropped.
* No VPS login, no PM2, no Nginx, no Certbot, no firewall change.
* No application code, UI, or feature removed.

