# Psychiatry EMR & Clinical Practice System

A modern, secure, full-stack Electronic Medical Records (EMR) and Practice Management System tailored for Psychiatric, Neuropsychiatric, and Behavioral Health Clinics.

---

## 1. Project Overview
The Psychiatry EMR System provides end-to-end clinical workflow management, incorporating:
- **Role-Based Access Control (RBAC)** for Admin, Doctor, Receptionist, and Therapist staff.
- **Patient Management & Intake** with duplicate CNIC/Phone validation.
- **Clinical Consultations & Diagnoses** supporting structured Mental Status Exams (MSE) and ICD-10 diagnostic coding.
- **Psychiatric Prescriptions & Medication Safety** with dosage controls and 1-click prescription reuse.
- **Appointment Scheduling** with status progression and date filters.
- **Psychotherapy Tracking** with session notes, progress scoring (GAD-7/PHQ-9), and homework logging.
- **Billing & Payment Management** with backend-generated immutable receipt numbers (`RCP-2026-XXXX`).
- **Financial Collection Reporting** with daily and monthly revenue aggregations.
- **Audit Logging** tracking all database mutations across resources without blocking HTTP request execution.
- **Clinic Data Backup & Export** allowing structured JSON export and local database snapshots with zero credential leaks.

---

## 2. Requirements
- **Node.js**: v18.0.0 or higher
- **Package Manager**: npm v9.0.0 or higher
- **Database**: MongoDB v6.0 or higher (or MongoDB Atlas cluster)
- **Operating System**: Windows, macOS, or Linux

---

## 3. Installation

1. **Clone the Repository**:
   ```bash
   git clone <repository-url>
   cd psychiatrist-system
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

---

## 4. Environment Variables
Copy `.env.example` to `.env.local` for local development:

```bash
cp .env.example .env.local
```

### Required Configuration Key Reference:
- `MONGODB_URI`: Production connection string for MongoDB instance (e.g., `mongodb+srv://<user>:<password>@cluster.mongodb.net/psychiatrist_emr`).
- `JWT_SECRET`: 32+ character unique secret key for signing JWT tokens.
- `SESSION_SECRET`: 32+ character unique secret key for session encryption.
- `PORT`: Backend Express HTTP port (default: `5000`).
- `NODE_ENV`: Set to `production` in live environments.
- `NEXT_PUBLIC_API_URL`: Base REST API URL accessed by frontend (e.g., `https://api.yourclinic.com`).
- `ALLOWED_ORIGINS`: Comma-separated allowed frontend domains for production CORS.
- `INITIAL_ADMIN_EMAIL`: Email address for bootstrapping initial production admin account.
- `INITIAL_ADMIN_PASSWORD`: Secure password for initial production admin account.

---

## 5. Production Startup Commands
- **Backend Production Server**:
  ```bash
  NODE_ENV=production npm run backend
  ```
- **Frontend Production Web App**:
  ```bash
  npm run build
  npm run start
  ```

---

## 6. PRODUCTION DEPLOYMENT CHECKLIST

Follow this 17-step checklist before making the application publicly accessible:

1. [ ] **Create Production MongoDB Database**: Provision an isolated MongoDB Atlas cluster or hardened dedicated database instance.
2. [ ] **Configure Environment Variables**: Supply all required environment variables in your server hosting control panel.
3. [ ] **Configure JWT_SECRET**: Supply a unique, high-entropy 32+ character string for `JWT_SECRET`.
4. [ ] **Configure SESSION_SECRET**: Supply a unique, high-entropy 32+ character string for `SESSION_SECRET`.
5. [ ] **Configure NEXT_PUBLIC_API_URL**: Set `NEXT_PUBLIC_API_URL` to your production backend domain (e.g., `https://api.yourclinic.com`).
6. [ ] **Configure ALLOWED_ORIGINS**: Set `ALLOWED_ORIGINS` to include strictly your production frontend domain (e.g., `https://emr.yourclinic.com`).
7. [ ] **Deploy Backend**: Deploy the Node/Express service and verify clean startup logs.
8. [ ] **Verify Health Endpoint**: Query `GET /api/health` and verify HTTP 200 OK with `database: connected`.
9. [ ] **Deploy Frontend**: Build and deploy the Next.js frontend application.
10. [ ] **Verify Staff Login**: Log in with initial administrator credentials and verify JWT issuance.
11. [ ] **Verify Database Persistence**: Create a test record, restart backend process, and confirm state persistence.
12. [ ] **Verify RBAC Enforcements**: Confirm non-admin accounts receive 403 Forbidden on restricted endpoints.
13. [ ] **Verify HTTPS/TLS Encryption**: Ensure SSL/TLS certificates (HTTPS) are active across all endpoints.
14. [ ] **Verify Data Backup/Export**: Execute `GET /api/backup/export` and confirm zero password leaks in output.
15. [ ] **Verify Audit Logging**: Perform an administrative action and confirm audit record creation.
16. [ ] **Create Real Staff Accounts**: Create production staff accounts for Doctors, Receptionists, and Therapists.
17. [ ] **DO NOT Run Demo Seed against Production DB**: Confirm `scripts/seed.ts` is NOT executed on the live production database.

---

## 7. HOSTING OPTIONS & ARCHITECTURE

### Option A: Cloud PaaS Architecture (Next.js on Vercel + Express on Render/Railway + MongoDB Atlas)

- **Frontend Hosting**: Vercel (or Netlify)
  - Environment Variable Required: `NEXT_PUBLIC_API_URL=https://api.yourclinic.com`
- **Backend Hosting**: Render / Railway / Google Cloud Run
  - Environment Variables Required:
    - `MONGODB_URI=mongodb+srv://<dbuser>:<dbpass>@cluster0.mongodb.net/psychiatrist_emr?retryWrites=true&w=majority`
    - `JWT_SECRET=<32-char-random-string>`
    - `SESSION_SECRET=<32-char-random-string>`
    - `PORT=5000`
    - `NODE_ENV=production`
    - `ALLOWED_ORIGINS=https://emr.yourclinic.com`
    - `INITIAL_ADMIN_EMAIL=admin@yourclinic.com`
    - `INITIAL_ADMIN_PASSWORD=<secure-prod-password>`
- **Database**: MongoDB Atlas Cluster (Dedicated M10+ with automated IP whitelisting).

---

### Option B: Unified VPS Architecture (Single Linux Server + Nginx Reverse Proxy + MongoDB Atlas)

- **Server Environment**: Ubuntu 24.04 LTS / AWS EC2 / DigitalOcean Droplet
- **Process Management**: PM2 managing both frontend (`npm run start`) and backend (`npm run backend`) processes.
- **Reverse Proxy**: Nginx routing `/` to `http://localhost:3000` and `/api/` to `http://localhost:5000`.
- **Environment File Configuration (`.env.local`)**:
  ```env
  MONGODB_URI=mongodb+srv://<dbuser>:<dbpass>@cluster0.mongodb.net/psychiatrist_emr?retryWrites=true&w=majority
  JWT_SECRET=<32-char-random-string>
  SESSION_SECRET=<32-char-random-string>
  PORT=5000
  NODE_ENV=production
  NEXT_PUBLIC_API_URL=https://emr.yourclinic.com
  ALLOWED_ORIGINS=https://emr.yourclinic.com
  INITIAL_ADMIN_EMAIL=admin@yourclinic.com
  INITIAL_ADMIN_PASSWORD=<secure-prod-password>
  ```
- **SSL/TLS**: Certbot (Let's Encrypt) provisioning automatic HTTPS certificates.

---

## 7.1 PostgreSQL Data Layer (Phase Three)

The application now runs on a repository-based data layer with two interchangeable
providers. All database access is server-side only; no secret key is ever exposed
to the browser bundle.

### Provider selection

| Provider | When it is used | Reads / writes | Transactions |
| --- | --- | --- | --- |
| `postgres` | `SUPABASE_URL` + `SUPABASE_SECRET_KEY` are configured | Supabase JS client (PostgREST) | `pg` Pool via `DATABASE_URL` (optional) |
| `mongodb` | Supabase is not configured, or `DB_PROVIDER=mongodb` | preserved Mongoose implementation | MongoDB |

`DATABASE_URL` on its own never selects the PostgreSQL stack: standard operations
require the Supabase client, and the pool is only used for atomic multi-entity
writes.

### Architecture

- `lib/db/config.ts` – provider resolution, credential masking, DNS pre-flight checks.
- `lib/db/supabase.ts` – memoized server-side Supabase client (`service role`/secret key).
- `lib/db/postgres.ts` – `pg` connection pool, `withTransaction()` (BEGIN/COMMIT/ROLLBACK), health probe.
- `lib/db/repositories/*` – one repository per entity; each supports Supabase → MongoDB fallback.
- `lib/db/repositories/consultationCascade.ts` – consultation + prescription + follow-up + chart timestamps in one transaction.
- `lib/db/errors.ts` – typed errors and safe HTTP mapping (503 / 409 / 400 / 500).
- `lib/audit.ts` – non-blocking audit logging shared by all Next.js route handlers.
- `ensureDatabaseReady()` – replaces `dbConnect()` in routes so PostgreSQL mode never opens MongoDB.

### Safety rules enforced in code

- Unresolvable Supabase hosts are rejected before any connection attempt (`isSupabaseReachable`).
- `receipt_number` is immutable in the application layer and enforced again by the
  `trg_payments_immutable_receipt` trigger in `supabase/migrations`.
- Patients use **soft deletion** (`is_active = false`, `status = 'Discharged'`); clinical
  records, prescriptions, appointments, payments, follow-ups and audit logs are preserved.
- Credentials are masked in logs; password hashes never leave the server.

### Validation

```bash
npm run test:postgres   # offline suite: repositories, transactions, auth, RBAC, errors
npx tsc --noEmit        # type check
npm run lint            # ESLint
npm run build           # production build
```

`npm run test:postgres` uses an in-memory Supabase double and a fake `pg` pool, so it
runs without any live project credentials.

---

## 8. Demo vs. Production Data Disclaimer
- **Demo Seed Script (`scripts/seed.ts`)**: Designed exclusively for local development and client demonstration. Automatically blocked from executing in production mode (`NODE_ENV=production`) unless `--force-production-seed` is explicitly supplied.
- **Production Seeding**: In production mode, the backend boots up cleanly without demo records and automatically seeds a single initial administrator account if `INITIAL_ADMIN_EMAIL` and `INITIAL_ADMIN_PASSWORD` are configured.
