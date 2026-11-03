/**
 * Phase Three: PostgreSQL Migration Validation Suite
 *
 * Runs entirely offline - no live Supabase project or PostgreSQL server is
 * required. A chainable in-memory Supabase client and a fake `pg` pool exercise
 * the repository layer, transactions, authentication, RBAC and error handling.
 *
 * Run with: npm run test:postgres
 */

process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'phase_three_test_session_secret_min_32_chars';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'phase_three_test_jwt_secret_min_32_characters';
process.env.SUPABASE_URL = 'https://phase-three-offline.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://phase-three-offline.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'sb_secret_phase_three_test_key';
process.env.DB_PROVIDER = 'postgres';

import { SignJWT } from 'jose';
import type { Request as ExpressRequest, Response as ExpressResponse } from 'express';

import {
  getDatabaseConfig,
  maskUri,
  isSupabaseReachable,
  ensureDatabaseReady,
  normalizeDatabaseError,
  DatabaseUnavailableError,
  RecordNotFoundError,
  setSupabaseClient,
  resetSupabaseClient,
  setPostgresPool,
  withTransaction,
} from '../lib/db';
import { getSession, hashPassword, verifyPassword } from '../lib/auth';
import { authorizeUser } from '../lib/permissions';
import {
  createPatient,
  listPatients,
  softDeletePatient,
  findPatientConflict,
} from '../lib/db/repositories/patientRepository';
import { findUserByEmail, createUser, countUsers } from '../lib/db/repositories/userRepository';
import { recordPayment, updatePayment, getPaymentById } from '../lib/db/repositories/billingRepository';
import { createConsultationCascade } from '../lib/db/repositories/consultationCascade';
import { listAuditLogs, recordAuditEvent } from '../lib/db/repositories/auditRepository';
import { getPracticeReport } from '../lib/db/repositories/reportRepository';
import { authenticate, requireRole } from '../backend/middleware/authMiddleware';
import * as patientsCollectionRoute from '../app/api/patients/route';
import * as patientDetailRoute from '../app/api/patients/[patientId]/route';

// ==============================================================================
// TEST FRAMEWORK
// ==============================================================================

interface TestResult {
  num: number;
  name: string;
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function check(num: number, name: string, passed: boolean, details: string): void {
  results.push({ num, name, passed, details });
  const symbol = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`${String(num).padStart(2, '0')}. ${name} -> ${symbol}`);
  console.log(`    └─ ${details}`);
}

async function runTest(
  num: number,
  name: string,
  fn: () => Promise<{ passed: boolean; details: string }>
): Promise<void> {
  try {
    const outcome = await fn();
    check(num, name, outcome.passed, outcome.details);
  } catch (error: any) {
    check(num, name, false, `Unexpected error: ${error?.message || error}`);
  }
}

function section(title: string): void {
  console.log(`\n${'='.repeat(78)}\n${title}\n${'='.repeat(78)}`);
}

type Row = Record<string, any>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function randomUuid(seed: number): string {
  return `00000000-0000-4000-8000-${seed.toString(16).padStart(12, '0')}`;
}

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

// ==============================================================================
// IN-MEMORY SUPABASE (PostgREST) TEST DOUBLE
// ==============================================================================

interface Filter {
  column: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'like' | 'ilike' | 'notIn' | 'in';
  value: any;
}

class FakeSupabaseClient {
  tables: Record<string, { rows: Row[]; nextId: number }> = {};
  statementLog: Array<{ table: string; operation: string; payload?: Row }> = [];
  failNextInsertFor?: string;

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [table, rows] of Object.entries(seed)) {
      this.tables[table] = { rows: rows.map((row) => ({ ...row })), nextId: rows.length + 1 };
    }
  }

  ensureTable(table: string) {
    if (!this.tables[table]) {
      this.tables[table] = { rows: [], nextId: 1 };
    }
    return this.tables[table];
  }

  from(table: string) {
    return new FakeQueryBuilder(this, table);
  }

  insertRow(table: string, row: Row): Row {
    const store = this.ensureTable(table);

    if (this.failNextInsertFor === table) {
      this.failNextInsertFor = undefined;
      throw new Error(`simulated insert failure on ${table}`);
    }

    const created: Row = {
      id: row.id || randomUuid(store.nextId),
      created_at: row.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...row,
    };
    if (!row.id) store.nextId += 1;
    store.rows.push(created);
    this.statementLog.push({ table, operation: 'insert', payload: row });
    return created;
  }
}

class FakeQueryBuilder {
  private filters: Filter[] = [];
  private orFilters: Filter[] | null = null;
  private orders: Array<{ column: string; ascending: boolean }> = [];
  private rangeBounds: { from: number; to: number } | null = null;
  private limitCount: number | null = null;
  private operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private payload: Row | null = null;
  private wantsCount = false;
  private headOnly = false;
  private selectedColumns: string | null = null;

  constructor(private client: FakeSupabaseClient, private table: string) {}

  select(columns: string = '*', options?: { count?: string; head?: boolean }) {
    this.selectedColumns = columns;
    if (options?.count) this.wantsCount = true;
    if (options?.head) this.headOnly = true;
    return this;
  }

  insert(row: Row) {
    this.operation = 'insert';
    this.payload = row;
    return this;
  }

  upsert(row: Row) {
    this.operation = 'upsert';
    this.payload = row;
    return this;
  }

  update(row: Row) {
    this.operation = 'update';
    this.payload = row;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column: string, value: any) {
    this.filters.push({ column, operator: 'eq', value });
    return this;
  }

  neq(column: string, value: any) {
    this.filters.push({ column, operator: 'neq', value });
    return this;
  }

  gt(column: string, value: any) {
    this.filters.push({ column, operator: 'gt', value });
    return this;
  }

  gte(column: string, value: any) {
    this.filters.push({ column, operator: 'gte', value });
    return this;
  }

  lt(column: string, value: any) {
    this.filters.push({ column, operator: 'lt', value });
    return this;
  }

  lte(column: string, value: any) {
    this.filters.push({ column, operator: 'lte', value });
    return this;
  }

  like(column: string, pattern: string) {
    this.filters.push({ column, operator: 'like', value: pattern });
    return this;
  }

  ilike(column: string, pattern: string) {
    this.filters.push({ column, operator: 'ilike', value: pattern });
    return this;
  }

  in(column: string, values: any[]) {
    this.filters.push({ column, operator: 'in', value: values });
    return this;
  }

  not(column: string, operator: string, value: string) {
    if (operator === 'in') {
      const values = value
        .replace(/^\(/, '')
        .replace(/\)$/, '')
        .split(',')
        .map((entry) => entry.trim().replace(/^"|"$/g, ''))
        .filter(Boolean);
      this.filters.push({ column, operator: 'notIn', value: values });
    }
    return this;
  }

  or(expression: string) {
    const parts = expression.split(',');
    this.orFilters = [];
    for (const part of parts) {
      const segments = part.split('.');
      if (segments.length < 3) continue;
      const column = segments[0];
      const operator = segments[1];
      const value = segments.slice(2).join('.');
      if (operator === 'eq') this.orFilters.push({ column, operator: 'eq', value });
      else if (operator === 'ilike') this.orFilters.push({ column, operator: 'ilike', value });
      else if (operator === 'like') this.orFilters.push({ column, operator: 'like', value });
      else if (operator === 'neq') this.orFilters.push({ column, operator: 'neq', value });
    }
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.orders.push({ column, ascending: options?.ascending !== false });
    return this;
  }

  limit(count: number) {
    this.limitCount = count;
    return this;
  }

  range(from: number, to: number) {
    this.rangeBounds = { from, to };
    return this;
  }

  maybeSingle() {
    return this.execute(true);
  }

  single() {
    return this.execute(false);
  }

  then(resolve: (value: any) => any, reject?: (reason: any) => any) {
    return this.execute().then(resolve, reject);
  }

  private matches(row: Row, filter: Filter): boolean {
    const raw = row[filter.column];
    switch (filter.operator) {
      case 'eq':
        return String(raw) === String(filter.value);
      case 'neq':
        return String(raw) !== String(filter.value);
      case 'gt':
        return String(raw) > String(filter.value);
      case 'gte':
        return String(raw) >= String(filter.value);
      case 'lt':
        return String(raw) < String(filter.value);
      case 'lte':
        return String(raw) <= String(filter.value);
      case 'like':
        return likeToRegExp(String(filter.value)).test(String(raw ?? ''));
      case 'ilike':
        return likeToRegExp(String(filter.value)).test(String(raw ?? ''));
      case 'in':
        return (filter.value as any[]).map(String).includes(String(raw));
      case 'notIn':
        return !(filter.value as any[]).map(String).includes(String(raw));
      default:
        return true;
    }
  }

  private matchesAll(row: Row): boolean {
    const andOk = this.filters.every((filter) => this.matches(row, filter));
    if (!this.orFilters || this.orFilters.length === 0) return andOk;
    return andOk && this.orFilters.some((filter) => this.matches(row, filter));
  }

  private async execute(maybeSingle = false): Promise<{ data: any; error: any; count?: number | null }> {
    const store = this.client.ensureTable(this.table);

    if (this.operation === 'insert' || this.operation === 'upsert') {
      const payload = this.payload || {};

      if (this.operation === 'upsert') {
        const existingIndex = store.rows.findIndex((row) => row.id === payload.id);
        if (existingIndex >= 0) {
          store.rows[existingIndex] = {
            ...store.rows[existingIndex],
            ...payload,
            updated_at: new Date().toISOString(),
          };
          this.client.statementLog.push({ table: this.table, operation: 'upsert', payload });
          return { data: store.rows[existingIndex], error: null };
        }
      }

      try {
        const created = this.client.insertRow(this.table, payload);
        return { data: created, error: null };
      } catch (error: any) {
        return { data: null, error: { message: error.message } };
      }
    }

    let rows = store.rows.filter((row) => this.matchesAll(row));

    if (this.operation === 'update') {
      for (const row of rows) {
        Object.assign(row, this.payload, { updated_at: new Date().toISOString() });
      }
      this.client.statementLog.push({ table: this.table, operation: 'update', payload: this.payload || {} });
      return { data: maybeSingle ? rows[0] || null : rows, error: null, count: rows.length };
    }

    if (this.operation === 'delete') {
      const idsToRemove = new Set(rows.map((row) => row.id));
      store.rows = store.rows.filter((row) => !idsToRemove.has(row.id));
      this.client.statementLog.push({ table: this.table, operation: 'delete' });
      return { data: null, error: null, count: rows.length };
    }

    const total = rows.length;

    for (const order of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const left = String(a[order.column] ?? '');
        const right = String(b[order.column] ?? '');
        const comparison = left < right ? -1 : left > right ? 1 : 0;
        return order.ascending ? comparison : -comparison;
      });
    }

    if (this.rangeBounds) {
      rows = rows.slice(this.rangeBounds.from, this.rangeBounds.to + 1);
    }
    if (this.limitCount !== null) {
      rows = rows.slice(0, this.limitCount);
    }

    if (this.headOnly) {
      return { data: null, error: null, count: total };
    }

    if (this.selectedColumns && this.selectedColumns !== '*') {
      const columns = this.selectedColumns.split(',').map((column) => column.trim());
      rows = rows.map((row) => {
        const projected: Row = {};
        for (const column of columns) projected[column] = row[column];
        return projected;
      });
    }

    if (maybeSingle) {
      return { data: rows[0] || null, error: null, count: total };
    }

    return { data: rows, error: null, count: total };
  }
}

// ==============================================================================
// FAKE pg POOL
// ==============================================================================

class FakePgClient {
  constructor(private pool: FakePgPool) {}

  async query(text: string, params?: any[]): Promise<{ rows: Row[] }> {
    return this.pool.handleQuery(text, params);
  }

  release() {
    this.pool.released += 1;
  }
}

class FakePgPool {
  statements: Array<{ text: string; params?: any[] }> = [];
  released = 0;
  committed = 0;
  rolledBack = 0;
  private handler: (text: string, params?: any[]) => { rows: Row[] };

  constructor(handler?: (text: string, params?: any[]) => { rows: Row[] }) {
    this.handler = handler || (() => ({ rows: [] }));
  }

  setHandler(handler: (text: string, params?: any[]) => { rows: Row[] }) {
    this.handler = handler;
  }

  handleQuery(text: string, params?: any[]): { rows: Row[] } {
    this.statements.push({ text, params });
    const normalized = text.trim().toUpperCase();
    if (normalized === 'BEGIN') return { rows: [] };
    if (normalized === 'COMMIT') {
      this.committed += 1;
      return { rows: [] };
    }
    if (normalized === 'ROLLBACK') {
      this.rolledBack += 1;
      return { rows: [] };
    }
    return this.handler(text, params);
  }

  async connect(): Promise<FakePgClient> {
    return new FakePgClient(this);
  }

  async query(text: string, params?: any[]): Promise<{ rows: Row[] }> {
    return this.handleQuery(text, params);
  }

  async end(): Promise<void> {
    return;
  }
}

// ==============================================================================
// FIXTURES & HELPERS
// ==============================================================================

const PATIENT_A = {
  id: randomUuid(11),
  patient_id: 'PX-9401',
  full_name: 'Ayesha Khan',
  date_of_birth: '1990-04-12',
  age: 35,
  gender: 'Female',
  phone: '+92-300-1112233',
  email: 'ayesha@example.com',
  address: '12 Mall Road',
  emergency_contact: { name: 'Bilal Khan', relationship: 'Spouse', phone: '+92-300-9998877' },
  clinical_intake: { presentingComplaint: 'Insomnia', riskAssessment: 'Low' },
  status: 'Active',
  registered_date: new Date().toISOString().split('T')[0],
  last_visit_date: 'N/A',
  next_follow_up_date: 'N/A',
  is_active: true,
  created_by: 'USR-001',
  updated_by: 'USR-001',
  created_at: '2026-01-05T09:00:00.000Z',
};

const PATIENT_B = {
  id: randomUuid(12),
  patient_id: 'PX-9402',
  full_name: 'Imran Sheikh',
  date_of_birth: '1985-11-02',
  age: 40,
  gender: 'Male',
  phone: '+92-300-4445566',
  email: 'imran@example.com',
  address: '45 Clifton',
  emergency_contact: {},
  clinical_intake: { presentingComplaint: 'Anxiety', riskAssessment: 'Low' },
  status: 'Active',
  registered_date: '2025-12-01',
  last_visit_date: 'N/A',
  next_follow_up_date: 'N/A',
  is_active: true,
  created_by: 'USR-001',
  updated_by: 'USR-001',
  created_at: '2026-01-06T09:00:00.000Z',
};

const PATIENT_INACTIVE = {
  id: randomUuid(13),
  patient_id: 'PX-9399',
  full_name: 'Soft Deleted Chart',
  date_of_birth: '1979-02-02',
  age: 46,
  gender: 'Other',
  phone: '+92-300-0000000',
  email: '',
  address: '',
  emergency_contact: {},
  clinical_intake: {},
  status: 'Discharged',
  registered_date: '2025-11-01',
  last_visit_date: 'N/A',
  next_follow_up_date: 'N/A',
  is_active: false,
  created_by: 'USR-001',
  updated_by: 'USR-001',
  created_at: '2025-11-02T09:00:00.000Z',
};

interface FixtureOptions {
  passwordHash: string;
}

const STAFF_USERS = (passwordHash: string) => [
  {
    id: randomUuid(1),
    user_id: 'USR-001',
    name: 'Clinic Administrator',
    email: 'admin@clinic.com',
    password_hash: passwordHash,
    role: 'ADMIN',
    phone: '',
    avatar: '',
    title: 'System Administrator',
    department: 'Administration',
    permissions: {
      canWriteClinicalNotes: true,
      canPrescribe: true,
      canManagePatients: true,
      canManageAppointments: true,
      canManageUsers: true,
      canViewReports: true,
    },
    is_active: true,
    last_active: 'Never',
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: randomUuid(2),
    user_id: 'USR-004',
    name: 'Sarah Jenkins',
    email: 'reception@clinic.com',
    password_hash: passwordHash,
    role: 'RECEPTIONIST',
    phone: '',
    avatar: '',
    title: 'Clinical Coordinator',
    department: 'Reception',
    permissions: {
      canWriteClinicalNotes: false,
      canPrescribe: false,
      canManagePatients: true,
      canManageAppointments: true,
      canManageUsers: false,
      canViewReports: false,
    },
    is_active: true,
    last_active: 'Never',
    created_at: '2026-01-02T00:00:00.000Z',
  },
  {
    id: randomUuid(3),
    user_id: 'USR-009',
    name: 'Deactivated Doctor',
    email: 'inactive@clinic.com',
    password_hash: passwordHash,
    role: 'DOCTOR',
    permissions: {},
    is_active: false,
    last_active: 'Never',
    created_at: '2026-01-03T00:00:00.000Z',
  },
];
function buildFixtureClient(options: FixtureOptions): FakeSupabaseClient {
  return new FakeSupabaseClient({
    users: STAFF_USERS(options.passwordHash) as Row[],
    patients: [PATIENT_A, PATIENT_B, PATIENT_INACTIVE],
    appointments: [
      {
        id: randomUuid(21),
        appointment_id: 'APT-1001',
        patient_id: 'PX-9402',
        patient_name: 'Imran Sheikh',
        doctor_id: 'USR-001',
        doctor_name: 'Clinic Administrator',
        clinician_id: 'USR-001',
        clinician_name: 'Clinic Administrator',
        appointment_date: '2026-02-01',
        appointment_time: '10:00 AM',
        duration_minutes: 45,
        appointment_type: 'Follow-up Consultation',
        status: 'Scheduled',
        created_at: '2026-01-20T00:00:00.000Z',
      },
      {
        id: randomUuid(22),
        appointment_id: 'APT-1002',
        patient_id: 'PX-9402',
        patient_name: 'Imran Sheikh',
        doctor_id: 'USR-001',
        doctor_name: 'Clinic Administrator',
        clinician_id: 'USR-001',
        clinician_name: 'Clinic Administrator',
        appointment_date: '2026-02-02',
        appointment_time: '11:00 AM',
        duration_minutes: 45,
        appointment_type: 'Follow-up Consultation',
        status: 'Completed',
        created_at: '2026-01-21T00:00:00.000Z',
      },
    ],
    consultations: [
      {
        id: randomUuid(31),
        consultation_id: 'CNS-101',
        patient_id: 'PX-9402',
        patient_name: 'Imran Sheikh',
        doctor_id: 'USR-001',
        doctor_name: 'Clinic Administrator',
        clinician_id: 'USR-001',
        clinician_name: 'Clinic Administrator',
        consultation_date: '2026-01-25',
        diagnosis: { primaryICD: 'F41.1', primaryTitle: 'Generalized anxiety disorder' },
        medications: [],
        created_at: '2026-01-25T00:00:00.000Z',
      },
    ],
    prescriptions: [
      {
        id: randomUuid(41),
        prescription_id: 'RX-901',
        patient_id: 'PX-9402',
        patient_name: 'Imran Sheikh',
        doctor_id: 'USR-001',
        doctor_name: 'Clinic Administrator',
        prescription_date: '2026-01-25',
        diagnosis: 'GAD',
        medications: [],
        status: 'Active',
        created_at: '2026-01-25T00:00:00.000Z',
      },
    ],
    follow_ups: [
      {
        id: randomUuid(51),
        follow_up_id: 'FLP-301',
        patient_id: 'PX-9402',
        patient_name: 'Imran Sheikh',
        follow_up_date: '2026-02-10',
        status: 'Upcoming',
        created_at: '2026-01-25T00:00:00.000Z',
      },
    ],
    payments: [
      {
        id: randomUuid(61),
        payment_id: 'PY-401',
        receipt_number: 'RCP-2026-0101',
        patient_id: 'PX-9402',
        patient_name: 'Imran Sheikh',
        service: 'Consultation Service',
        fee_category: 'Consultation',
        amount: 250,
        payment_method: 'Cash',
        payment_status: 'Paid',
        date: '2026-01-25',
        created_at: '2026-01-25T00:00:00.000Z',
      },
    ],
    fee_categories: [
      {
        id: randomUuid(71),
        category_id: 'FC-101',
        name: 'Initial Consultation',
        default_fee: 250,
        amount: 250,
        is_active: true,
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ],
    audit_logs: [
      {
        id: randomUuid(81),
        log_id: 'LOG-8901',
        timestamp: '2026-01-25T10:00:00.000Z',
        user_id: 'USR-001',
        user_name: 'Clinic Administrator',
        user_role: 'ADMIN',
        action: 'LOGIN',
        module: 'AUTH',
        description: 'User logged in successfully',
        metadata: {},
        created_at: '2026-01-25T10:00:00.000Z',
      },
      {
        id: randomUuid(82),
        log_id: 'LOG-8902',
        timestamp: '2026-01-26T10:00:00.000Z',
        user_id: 'USR-001',
        user_name: 'Clinic Administrator',
        user_role: 'ADMIN',
        action: 'CREATE',
        module: 'PATIENTS',
        description: 'Registered new patient',
        metadata: {},
        created_at: '2026-01-26T10:00:00.000Z',
      },
    ],
    clinic_settings: [
      {
        id: 1,
        clinic_name: 'Neuro Psychiatry Clinic',
        doctor_name: 'DR SHAHAB MUHAMMAD',
        license_number: 'NY-MED-849201',
        working_days: ['Monday', 'Wednesday'],
        clinic_start_time: '18:00',
        clinic_end_time: '20:00',
        appointment_duration: 45,
        consultation_fee: 250,
      },
    ],
  });
}

async function createSessionToken(payload: Record<string, any>, expiresIn = '1h'): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SESSION_SECRET as string);
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

function bearerRequest(url: string, token?: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (init.body) headers.set('content-type', 'application/json');
  return new Request(url, { ...init, headers });
}

/** Minimal Express request/response doubles. */
function expressDoubles(overrides: { headers?: Record<string, string>; user?: any } = {}) {
  const req: any = {
    headers: overrides.headers || {},
    user: overrides.user,
    params: {},
    query: {},
    body: {},
  };

  const captured: { status?: number; body?: any } = {};
  const res: any = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(payload: any) {
      captured.body = payload;
      return res;
    },
    cookie() {
      return res;
    },
    clearCookie() {
      return res;
    },
  };

  let nextCalled = false;
  const next = (error?: any) => {
    nextCalled = true;
    if (error) throw error;
  };

  return { req, res, next, captured, nextWasCalled: () => nextCalled };
}

// ==============================================================================
// TEST SUITE
// ==============================================================================

async function main(): Promise<void> {
  console.log('\n🧪 Phase Three PostgreSQL Migration Validation Suite');
  console.log('   Offline mode: in-memory Supabase client + fake pg pool\n');

  const passwordHash = await hashPassword('Admin@123456');
  const client = buildFixtureClient({ passwordHash });
  setSupabaseClient(client as any);

  const adminToken = await createSessionToken({
    userId: 'USR-001',
    email: 'admin@clinic.com',
    name: 'Clinic Administrator',
    role: 'ADMIN',
  });
  const receptionToken = await createSessionToken({
    userId: 'USR-004',
    email: 'reception@clinic.com',
    name: 'Sarah Jenkins',
    role: 'RECEPTIONIST',
  });

  // ----------------------------------------------------------------------------
  // A. CONFIGURATION & CREDENTIAL PROTECTION
  // ----------------------------------------------------------------------------
  section('A. Database configuration & credential protection');

  await runTest(1, 'Provider resolves to PostgreSQL when Supabase credentials exist', async () => {
    const config = getDatabaseConfig();
    return {
      passed: config.provider === 'postgres' && config.isSupabaseConfigured,
      details: `provider=${config.provider}, supabaseConfigured=${config.isSupabaseConfigured}`,
    };
  });

  await runTest(2, 'DATABASE_URL alone never selects the PostgreSQL stack', async () => {
    const saved = {
      supabaseUrl: process.env.SUPABASE_URL,
      publicUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      secret: process.env.SUPABASE_SECRET_KEY,
      provider: process.env.DB_PROVIDER,
      databaseUrl: process.env.DATABASE_URL,
    };

    process.env.SUPABASE_URL = '';
    process.env.NEXT_PUBLIC_SUPABASE_URL = '';
    process.env.SUPABASE_SECRET_KEY = '';
    delete process.env.DB_PROVIDER;
    process.env.DATABASE_URL = 'postgresql://user:secret@127.0.0.1:5432/emr';

    const config = getDatabaseConfig();
    const passed = config.provider === 'mongodb' && config.isPostgresConfigured;

    process.env.SUPABASE_URL = saved.supabaseUrl;
    process.env.NEXT_PUBLIC_SUPABASE_URL = saved.publicUrl;
    process.env.SUPABASE_SECRET_KEY = saved.secret;
    process.env.DB_PROVIDER = saved.provider;
    if (saved.databaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = saved.databaseUrl;

    return {
      passed,
      details: `provider=${config.provider} (expected mongodb), pgConfigured=${config.isPostgresConfigured}`,
    };
  });

  await runTest(3, 'Credential masking never exposes usernames or passwords', async () => {
    const masked = maskUri('postgresql://clinic_user:SuperSecret123@db.example.com:5432/emr');
    const passed = !masked.includes('SuperSecret123') && !masked.includes('clinic_user');
    return { passed, details: `maskedUri=${masked}` };
  });

  await runTest(4, 'Unresolvable Supabase host is rejected without a live connection', async () => {
    resetSupabaseClient();
    const savedUrl = process.env.SUPABASE_URL;
    const savedPublic = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_URL = 'https://phase-three-unresolvable-host.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://phase-three-unresolvable-host.supabase.co';

    const reachable = await isSupabaseReachable();

    process.env.SUPABASE_URL = savedUrl;
    process.env.NEXT_PUBLIC_SUPABASE_URL = savedPublic;
    setSupabaseClient(client as any);

    return {
      passed: reachable === false,
      details: `isSupabaseReachable=${reachable} (DNS rejected; no connection attempted)`,
    };
  });

  await runTest(5, 'ensureDatabaseReady honours the injected PostgreSQL client', async () => {
    const provider = await ensureDatabaseReady();
    return { passed: provider === 'postgres', details: `provider=${provider}` };
  });
  // ----------------------------------------------------------------------------
  // B. REPOSITORY OPERATIONS
  // ----------------------------------------------------------------------------
  section('B. Repository operations (patients, users, billing, audit, reports)');

  await runTest(6, 'Patient creation maps camelCase fields and records the creator', async () => {
    const patient = await createPatient(
      {
        fullName: 'Test Patient',
        dateOfBirth: '1992-03-15',
        age: 33,
        gender: 'Female',
        phone: '+92-300-7778899',
        email: 'test.patient@example.com',
        address: '9 Garden Avenue',
        emergencyContact: { name: 'Kin', relationship: 'Sibling', phone: '+92-300-1110000' },
        clinicalIntake: { presentingComplaint: 'Low mood' },
        status: 'Active',
      },
      'USR-001'
    );

    const row = client.tables.patients.rows.find((r) => r.patient_id === patient.patientId);
    const passed =
      patient.patientId.startsWith('PX-') &&
      patient.fullName === 'Test Patient' &&
      patient.emergencyContact?.name === 'Kin' &&
      row?.created_by === 'USR-001';
    return { passed, details: `created ${patient.patientId}, created_by=${row?.created_by}` };
  });

  await runTest(7, 'Duplicate patient charts are detected by phone', async () => {
    const conflict = await findPatientConflict('+92-300-1112233');
    return { passed: conflict?.patientId === 'PX-9401', details: `conflict=${conflict?.patientId || 'none'}` };
  });

  await runTest(8, 'Patient listing excludes inactive charts and paginates', async () => {
    const result = await listPatients({ page: 1, limit: 2 });
    const ids = result.data.map((p) => p.patientId);
    const passed = result.data.length === 2 && !ids.includes('PX-9399');
    return { passed, details: `total=${result.total}, pageSize=${result.data.length}, ids=${ids.join(',')}` };
  });

  await runTest(9, 'Patient soft delete preserves the clinical record row intact', async () => {
    const before = client.tables.patients.rows.length;
    const deleted = await softDeletePatient('PX-9401', 'USR-001');
    const after = client.tables.patients.rows.length;
    const row = client.tables.patients.rows.find((r) => r.patient_id === 'PX-9401');

    const passed =
      Boolean(deleted) && before === after && row?.is_active === false && row?.status === 'Discharged';
    return {
      passed,
      details: `rows before=${before}, after=${after}, is_active=${row?.is_active}, status=${row?.status}`,
    };
  });

  await runTest(10, 'User lookup by email maps role and permission matrix', async () => {
    const user = await findUserByEmail('RECEPTION@clinic.com');
    const passed =
      user?.userId === 'USR-004' &&
      user?.role === 'RECEPTIONIST' &&
      user?.permissions?.canPrescribe === false &&
      Boolean(user?.passwordHash);
    return {
      passed,
      details: `user=${user?.userId}, role=${user?.role}, canPrescribe=${user?.permissions?.canPrescribe}`,
    };
  });

  await runTest(11, 'User creation bcrypt-hashes passwords and applies defaults', async () => {
    const before = await countUsers();
    const created = await createUser({
      name: 'Dr. New Hire',
      email: 'new.doctor@clinic.com',
      password: 'DoctorPass123!',
      role: 'DOCTOR',
    });
    const after = await countUsers();
    const row = client.tables.users.rows.find((u) => u.user_id === created.userId);
    const passed =
      after === before + 1 &&
      row?.password_hash !== 'DoctorPass123!' &&
      String(row?.password_hash).startsWith('$2') &&
      created.permissions.canPrescribe === true &&
      created.permissions.canManageUsers === false;
    return {
      passed,
      details: `users ${before}->${after}, hashPrefix=${String(row?.password_hash).slice(0, 4)}`,
    };
  });

  await runTest(12, 'Payment receipt numbers use the RCP-YYYY-XXXX contract', async () => {
    const payment = await recordPayment({
      patientId: 'PX-9402',
      patientName: 'Imran Sheikh',
      amount: 300,
      service: 'Follow-up Consultation',
      feeCategory: 'Consultation',
      paymentMethod: 'Cash',
      date: '2026-02-03',
      createdBy: 'USR-001',
    });
    const passed = /^RCP-\d{4}-\d{4}$/.test(payment.receiptNumber) && payment.amount === 300;
    return { passed, details: `receipt=${payment.receiptNumber}, amount=${payment.amount}` };
  });

  await runTest(13, 'Receipt numbers are immutable through the update path', async () => {
    await updatePayment('PY-401', { receiptNumber: 'RCP-2026-9999', amount: 260 } as any);
    const row = client.tables.payments.rows.find((r) => r.payment_id === 'PY-401');
    const passed = row?.receipt_number === 'RCP-2026-0101' && Number(row?.amount) === 260;
    return { passed, details: `receipt_number=${row?.receipt_number} (unchanged), amount=${row?.amount}` };
  });

  await runTest(14, 'Non-positive payment amounts are rejected before insert', async () => {
    let threw = false;
    try {
      await recordPayment({ patientId: 'PX-9402', patientName: 'Imran Sheikh', amount: 0 } as any);
    } catch (error: any) {
      threw = /positive monetary value/.test(error.message);
    }
    return { passed: threw, details: 'amount=0 rejected with a validation error' };
  });

  await runTest(15, 'Audit log search and role filters are applied', async () => {
    const searched = await listAuditLogs({ search: 'patient', page: 1, limit: 50 });
    const byRole = await listAuditLogs({ userRole: 'ADMIN', action: 'LOGIN', page: 1, limit: 50 });
    const passed =
      searched.data.length === 1 &&
      searched.data[0].logId === 'LOG-8902' &&
      byRole.data.length === 1 &&
      byRole.data[0].logId === 'LOG-8901';
    return { passed, details: `searchMatches=${searched.data.length}, roleMatches=${byRole.data.length}` };
  });

  await runTest(16, 'Practice report aggregates core counts', async () => {
    const report = await getPracticeReport();
    const passed =
      report.summary.totalPatients === 4 &&
      report.summary.totalAppointments === 2 &&
      report.summary.totalConsultations === 1 &&
      report.summary.totalPrescriptions === 1 &&
      report.followUps.Upcoming === 1;
    return {
      passed,
      details: `patients=${report.summary.totalPatients}, appointments=${report.summary.totalAppointments}, followUps=${JSON.stringify(report.followUps)}`,
    };
  });

  // ----------------------------------------------------------------------------
  // C. TRANSACTIONS (pg pool)
  // ----------------------------------------------------------------------------
  section('C. PostgreSQL transactions (BEGIN / COMMIT / ROLLBACK)');

  await runTest(17, 'withTransaction commits and releases the client', async () => {
    const pool = new FakePgPool();
    setPostgresPool(pool as any);

    const result = await withTransaction(async (tx) => {
      await tx.query('UPDATE patients SET status = $1 WHERE patient_id = $2', ['Active', 'PX-9402']);
      return 'committed';
    });

    setPostgresPool(null);
    const passed =
      result === 'committed' && pool.committed === 1 && pool.rolledBack === 0 && pool.released === 1;
    return {
      passed,
      details: `commit=${pool.committed}, rollback=${pool.rolledBack}, released=${pool.released}`,
    };
  });

  await runTest(18, 'withTransaction rolls back and rethrows on failure', async () => {
    const pool = new FakePgPool();
    setPostgresPool(pool as any);

    let caught = '';
    try {
      await withTransaction(async (tx) => {
        await tx.query('INSERT INTO payments (payment_id) VALUES ($1)', ['PY-FAIL']);
        throw new Error('simulated downstream failure');
      });
    } catch (error: any) {
      caught = error.message;
    }

    setPostgresPool(null);
    const passed =
      /simulated downstream failure/.test(caught) &&
      pool.committed === 0 &&
      pool.rolledBack === 1 &&
      pool.released === 1;
    return {
      passed,
      details: `commit=${pool.committed}, rollback=${pool.rolledBack}, released=${pool.released}`,
    };
  });

  await runTest(19, 'recordPayment runs inside a pg transaction and maps the row', async () => {
    const pool = new FakePgPool((text, params) => {
      if (/INSERT INTO payments/i.test(text)) {
        return {
          rows: [
            {
              id: randomUuid(900),
              payment_id: params?.[0],
              receipt_number: params?.[1],
              patient_id: params?.[2],
              patient_name: params?.[3],
              service: params?.[7],
              fee_category: params?.[8],
              amount: params?.[9],
              payment_method: params?.[10],
              payment_status: params?.[11],
              date: params?.[12],
            },
          ],
        };
      }
      return { rows: [] };
    });

    setPostgresPool(pool as any);

    const payment = await recordPayment({
      patientId: 'PX-9402',
      patientName: 'Imran Sheikh',
      amount: 450,
      service: 'Therapy Session',
      feeCategory: 'Therapy',
      date: '2026-02-04',
    });

    setPostgresPool(null);

    const insert = pool.statements.find((s) => /INSERT INTO payments/i.test(s.text));
    const passed =
      Boolean(insert) &&
      pool.committed === 1 &&
      /^RCP-\d{4}-\d{4}$/.test(payment.receiptNumber) &&
      payment.amount === 450 &&
      payment.patientId === 'PX-9402';
    return {
      passed,
      details: `inserted=${Boolean(insert)}, commit=${pool.committed}, receipt=${payment.receiptNumber}`,
    };
  });

  await runTest(20, 'Consultation cascade writes all entities in a single transaction', async () => {
    const pool = new FakePgPool((text, params) => {
      const trimmed = text.trim();
      if (/^SELECT COUNT\(\*\)::int AS total FROM consultations/i.test(trimmed)) return { rows: [{ total: 1 }] };
      if (/^SELECT 1 FROM consultations/i.test(trimmed)) return { rows: [] };
      if (/^SELECT COUNT\(\*\)::int AS total FROM prescriptions/i.test(trimmed)) return { rows: [{ total: 1 }] };
      if (/^SELECT 1 FROM prescriptions/i.test(trimmed)) return { rows: [] };
      if (/^SELECT COUNT\(\*\)::int AS total FROM follow_ups/i.test(trimmed)) return { rows: [{ total: 1 }] };
      if (/^SELECT 1 FROM follow_ups/i.test(trimmed)) return { rows: [] };

      if (/INSERT INTO consultations/i.test(text)) {
        return {
          rows: [
            {
              id: randomUuid(910),
              consultation_id: params?.[0],
              patient_id: params?.[1],
              patient_name: params?.[2],
              doctor_id: params?.[3],
              doctor_name: params?.[4],
              consultation_date: params?.[7],
              diagnosis: params?.[14],
              medications: JSON.parse(String(params?.[16] || '[]')),
            },
          ],
        };
      }
      if (/INSERT INTO prescriptions/i.test(text)) {
        return {
          rows: [
            {
              id: randomUuid(911),
              prescription_id: params?.[0],
              patient_id: params?.[1],
              patient_name: params?.[2],
              doctor_id: params?.[5],
              doctor_name: params?.[6],
              prescription_date: params?.[10],
              diagnosis: params?.[13],
              medications: JSON.parse(String(params?.[14] || '[]')),
              status: params?.[17],
            },
          ],
        };
      }
      if (/INSERT INTO follow_ups/i.test(text)) {
        return {
          rows: [
            {
              id: randomUuid(912),
              follow_up_id: params?.[0],
              patient_id: params?.[1],
              patient_name: params?.[2],
              assigned_doctor: params?.[5],
              follow_up_date: params?.[8],
              status: params?.[11],
            },
          ],
        };
      }
      return { rows: [] };
    });

    setPostgresPool(pool as any);

    const result = await createConsultationCascade({
      consultation: {
        patientId: 'PX-9402',
        patientName: 'Imran Sheikh',
        doctorId: 'USR-001',
        doctorName: 'Dr. Cascade',
        consultationDate: '2026-02-05',
        presentingComplaint: 'Anxiety',
        clinicalObservations: 'Alert and oriented',
        assessment: 'GAD',
        diagnosis: { primaryICD: 'F41.1', primaryTitle: 'Generalized anxiety disorder' },
        treatmentPlan: 'Start SSRI',
        medications: [{ name: 'Sertraline', dosage: '50mg' }],
        followUpDate: '2026-03-05',
        followUpNotes: 'Review response',
      },
      patient: { patientId: 'PX-9402', fullName: 'Imran Sheikh', age: 40, gender: 'Male' },
      actorId: 'USR-001',
    });

    setPostgresPool(null);

    const statementText = pool.statements.map((s) => s.text).join('\n');
    const passed =
      result.transactional === true &&
      Boolean(result.prescription) &&
      Boolean(result.followUp) &&
      pool.committed === 1 &&
      /INSERT INTO consultations/i.test(statementText) &&
      /INSERT INTO prescriptions/i.test(statementText) &&
      /INSERT INTO follow_ups/i.test(statementText) &&
      /UPDATE patients/i.test(statementText);
    return {
      passed,
      details: `statements=${pool.statements.length}, commit=${pool.committed}, rx=${result.prescription?.prescriptionId}, followUp=${result.followUp?.followUpId}`,
    };
  });

  await runTest(21, 'Cascade rolls back every write when a downstream insert fails', async () => {
    let failPrescription = true;
    const pool = new FakePgPool((text, params) => {
      const trimmed = text.trim();
      if (failPrescription && /INSERT INTO prescriptions/i.test(text)) {
        failPrescription = false;
        throw new Error('simulated prescription constraint violation');
      }
      if (/^SELECT COUNT\(\*\)::int AS total FROM consultations/i.test(trimmed)) return { rows: [{ total: 0 }] };
      if (/^SELECT 1 FROM consultations/i.test(trimmed)) return { rows: [] };
      if (/^SELECT COUNT\(\*\)::int AS total FROM prescriptions/i.test(trimmed)) return { rows: [{ total: 0 }] };
      if (/^SELECT 1 FROM prescriptions/i.test(trimmed)) return { rows: [] };
      if (/INSERT INTO consultations/i.test(text)) {
        return {
          rows: [
            {
              id: randomUuid(920),
              consultation_id: params?.[0],
              patient_id: params?.[1],
              patient_name: params?.[2],
              consultation_date: params?.[7],
            },
          ],
        };
      }
      return { rows: [] };
    });

    setPostgresPool(pool as any);

    let caught = '';
    try {
      await createConsultationCascade({
        consultation: {
          patientId: 'PX-9402',
          patientName: 'Imran Sheikh',
          doctorId: 'USR-001',
          doctorName: 'Dr. Cascade',
          consultationDate: '2026-02-06',
          diagnosis: { primaryICD: 'F41.1', primaryTitle: 'GAD' },
          medications: [{ name: 'Sertraline' }],
        },
        patient: { patientId: 'PX-9402', fullName: 'Imran Sheikh' },
      });
    } catch (error: any) {
      caught = error.message;
    }

    setPostgresPool(null);

    const patientUpdates = pool.statements.filter((s) => /UPDATE patients/i.test(s.text)).length;
    const passed =
      /simulated prescription constraint violation/.test(caught) &&
      pool.committed === 0 &&
      pool.rolledBack === 1 &&
      patientUpdates === 0 &&
      pool.released === 1;
    return {
      passed,
      details: `error="${caught}", commit=${pool.committed}, rollback=${pool.rolledBack}, patientUpdates=${patientUpdates}`,
    };
  });

  await runTest(22, 'Cascade falls back to sequential mode without a pg pool', async () => {
    setPostgresPool(null);

    const result = await createConsultationCascade({
      consultation: {
        patientId: 'PX-9402',
        patientName: 'Imran Sheikh',
        doctorId: 'USR-001',
        doctorName: 'Dr. Fallback',
        consultationDate: '2026-02-07',
        diagnosis: { primaryICD: 'F32.9', primaryTitle: 'Major depressive disorder' },
        medications: [{ name: 'Fluoxetine', dosage: '20mg' }],
        followUpDate: '2026-03-07',
      },
      patient: { patientId: 'PX-9402', fullName: 'Imran Sheikh', age: 40, gender: 'Male' },
    });

    const passed =
      result.transactional === false &&
      Boolean(result.consultation?.consultationId) &&
      Boolean(result.prescription?.prescriptionId) &&
      Boolean(result.followUp?.followUpId);
    return {
      passed,
      details: `transactional=${result.transactional}, consultation=${result.consultation?.consultationId}, rx=${result.prescription?.prescriptionId}`,
    };
  });

  // ----------------------------------------------------------------------------
  // D. AUTHENTICATION
  // ----------------------------------------------------------------------------
  section('D. Custom JWT authentication (bcrypt + HTTP-only cookie contract)');

  await runTest(23, 'bcrypt password hashing verifies correctly', async () => {
    const hash = await hashPassword('SecretPass123!');
    const good = await verifyPassword('SecretPass123!', hash);
    const bad = await verifyPassword('WrongPass123!', hash);
    const passed = good === true && bad === false && hash !== 'SecretPass123!';
    return { passed, details: `correctPassword=${good}, wrongPassword=${bad}, hashPrefix=${hash.slice(0, 4)}` };
  });

  await runTest(24, 'Bearer JWT session resolves to the signed payload', async () => {
    const request = bearerRequest('http://localhost/api/patients', adminToken);
    const session = await getSession(request);
    const passed = session?.userId === 'USR-001' && session?.role === 'ADMIN';
    return { passed, details: `userId=${session?.userId}, role=${session?.role}` };
  });

  await runTest(25, 'Expired or tampered tokens are rejected', async () => {
    const expired = await createSessionToken(
      { userId: 'USR-001', email: 'admin@clinic.com', name: 'Admin', role: 'ADMIN' },
      '-10s'
    );
    const expiredSession = await getSession(bearerRequest('http://localhost/api/patients', expired));
    const tamperedSession = await getSession(
      bearerRequest('http://localhost/api/patients', `${adminToken}tampered`)
    );
    const passed = expiredSession === null && tamperedSession === null;
    return {
      passed,
      details: `expired=${expiredSession === null}, tampered=${tamperedSession === null}`,
    };
  });

  await runTest(26, 'Requests without credentials resolve to no session', async () => {
    const session = await getSession(bearerRequest('http://localhost/api/patients'));
    return { passed: session === null, details: `session=${session}` };
  });

  // ----------------------------------------------------------------------------
  // E. ROLE-BASED ACCESS CONTROL
  // ----------------------------------------------------------------------------
  section('E. Role-based access control');

  await runTest(27, 'authorizeUser grants a permitted role', async () => {
    const auth = await authorizeUser(['ADMIN'], bearerRequest('http://localhost/api/audit-logs', adminToken));
    return {
      passed: auth.authorized && Boolean(auth.session) && !auth.response,
      details: `authorized=${auth.authorized}, role=${auth.session?.role}`,
    };
  });

  await runTest(28, 'authorizeUser rejects a forbidden role with 403', async () => {
    const auth = await authorizeUser(
      ['ADMIN'],
      bearerRequest('http://localhost/api/audit-logs', receptionToken)
    );
    const passed = auth.authorized === false && auth.response?.status === 403;
    return { passed, details: `authorized=${auth.authorized}, status=${auth.response?.status}` };
  });

  await runTest(29, 'authorizeUser rejects an unauthenticated request with 401', async () => {
    const auth = await authorizeUser(['ADMIN']);
    const passed = auth.authorized === false && auth.response?.status === 401;
    return { passed, details: `authorized=${auth.authorized}, status=${auth.response?.status}` };
  });

  await runTest(30, 'Express requireRole normalises RECEPTION / RECEPTIONIST', async () => {
    const middleware = requireRole('RECEPTION');
    const { req, res, next, captured, nextWasCalled } = expressDoubles({
      user: { userId: 'USR-004', role: 'RECEPTIONIST' },
    });
    middleware(req as ExpressRequest, res as ExpressResponse, next);

    const denied = expressDoubles({ user: { userId: 'USR-009', role: 'THERAPIST' } });
    middleware(denied.req as ExpressRequest, denied.res as ExpressResponse, denied.next);

    const passed =
      nextWasCalled() && captured.status === undefined && denied.captured.status === 403;
    return {
      passed,
      details: `receptionistAllowed=${nextWasCalled()}, therapistStatus=${denied.captured.status}`,
    };
  });

  await runTest(31, 'Express authenticate strips the hash and blocks inactive accounts', async () => {
    const ok = expressDoubles({ headers: { authorization: `Bearer ${adminToken}` } });
    await authenticate(ok.req as ExpressRequest, ok.res as ExpressResponse, ok.next);

    const inactiveToken = await createSessionToken({
      userId: 'USR-009',
      email: 'inactive@clinic.com',
      name: 'Deactivated Doctor',
      role: 'DOCTOR',
    });
    const blocked = expressDoubles({ headers: { authorization: `Bearer ${inactiveToken}` } });
    await authenticate(blocked.req as ExpressRequest, blocked.res as ExpressResponse, blocked.next);

    const passed =
      ok.nextWasCalled() &&
      ok.req.user?.userId === 'USR-001' &&
      ok.req.user?.passwordHash === undefined &&
      blocked.captured.status === 403;
    return {
      passed,
      details: `authenticated=${ok.req.user?.userId}, hashExposed=${'passwordHash' in (ok.req.user || {})}, inactiveStatus=${blocked.captured.status}`,
    };
  });

  // ----------------------------------------------------------------------------
  // F. ERROR HANDLING & ROUTE HANDLERS
  // ----------------------------------------------------------------------------
  section('F. Error handling & migrated Next.js route handlers');

  await runTest(32, 'normalizeDatabaseError maps typed failures to safe status codes', async () => {
    const unavailable = normalizeDatabaseError(new DatabaseUnavailableError());
    const notFound = normalizeDatabaseError(new RecordNotFoundError());
    const unique = normalizeDatabaseError(Object.assign(new Error('duplicate key'), { code: '23505' }));
    const passed =
      unavailable.statusCode === 503 &&
      notFound.statusCode === 404 &&
      unique.statusCode === 409 &&
      unique.code === 'UNIQUE_VIOLATION';
    return {
      passed,
      details: `503=${unavailable.statusCode}, 404=${notFound.statusCode}, 409=${unique.statusCode}`,
    };
  });

  await runTest(33, 'Repository failures are not leaked to API clients', async () => {
    client.failNextInsertFor = 'patients';
    let thrown: any = null;
    try {
      await createPatient({
        fullName: 'Broken Record',
        dateOfBirth: '1990-01-01',
        age: 35,
        gender: 'Female',
        phone: '+92-300-5556677',
      });
    } catch (error: any) {
      thrown = error;
    }

    const normalized = normalizeDatabaseError(thrown, 'Database error fetching patient records.');
    const passed =
      Boolean(thrown) &&
      normalized.statusCode === 500 &&
      normalized.message === 'Database error fetching patient records.' &&
      !normalized.message.includes('simulated insert failure');
    return { passed, details: `status=${normalized.statusCode}, message="${normalized.message}"` };
  });

  await runTest(34, 'GET /api/patients returns 401 without a session', async () => {
    const response = await patientsCollectionRoute.GET(bearerRequest('http://localhost/api/patients'));
    const body: any = await response.json();
    const passed = response.status === 401 && body.success === false;
    return { passed, details: `status=${response.status}, error="${body.error}"` };
  });

  await runTest(35, 'GET /api/patients returns the paginated contract for an admin', async () => {
    const response = await patientsCollectionRoute.GET(
      bearerRequest('http://localhost/api/patients?limit=2', adminToken)
    );
    const body: any = await response.json();
    const passed =
      response.status === 200 &&
      body.success === true &&
      Array.isArray(body.data) &&
      body.data.length === 2 &&
      typeof body.pagination?.totalPages === 'number';
    return {
      passed,
      details: `status=${response.status}, count=${body.data?.length}, pagination=${JSON.stringify(body.pagination)}`,
    };
  });

  await runTest(36, 'POST /api/patients rejects an invalid payload with 400', async () => {
    const response = await patientsCollectionRoute.POST(
      bearerRequest('http://localhost/api/patients', adminToken, {
        method: 'POST',
        body: JSON.stringify({ fullName: 'X' }),
      })
    );
    const body: any = await response.json();
    const passed = response.status === 400 && body.success === false;
    return { passed, details: `status=${response.status}, error="${body.error}"` };
  });

  await runTest(37, 'POST /api/patients rejects duplicate charts with 400', async () => {
    const response = await patientsCollectionRoute.POST(
      bearerRequest('http://localhost/api/patients', adminToken, {
        method: 'POST',
        body: JSON.stringify({
          fullName: 'Duplicate Imran',
          dateOfBirth: '1985-11-02',
          age: 40,
          gender: 'Male',
          phone: '+92-300-4445566',
        }),
      })
    );
    const body: any = await response.json();
    const passed = response.status === 400 && /already exists/i.test(body.error);
    return { passed, details: `status=${response.status}, error="${body.error}"` };
  });

  await runTest(38, 'DELETE /api/patients/[patientId] soft-deletes and audits the action', async () => {
    const beforeRows = client.tables.patients.rows.length;
    const beforeAudits = client.tables.audit_logs.rows.length;

    const response = await patientDetailRoute.DELETE(
      bearerRequest('http://localhost/api/patients/PX-9402', adminToken, { method: 'DELETE' }),
      { params: Promise.resolve({ patientId: 'PX-9402' }) }
    );
    const body: any = await response.json();

    const afterRows = client.tables.patients.rows.length;
    const afterAudits = client.tables.audit_logs.rows.length;
    const row = client.tables.patients.rows.find((r) => r.patient_id === 'PX-9402');

    const passed =
      response.status === 200 &&
      body.success === true &&
      /deactivated successfully/i.test(body.message) &&
      beforeRows === afterRows &&
      row?.is_active === false &&
      afterAudits === beforeAudits + 1;
    return {
      passed,
      details: `status=${response.status}, rows ${beforeRows}->${afterRows}, audit ${beforeAudits}->${afterAudits}`,
    };
  });

  await runTest(39, 'Soft-deleted charts remain readable for historical review', async () => {
    const response = await patientDetailRoute.GET(
      bearerRequest('http://localhost/api/patients/PX-9402', adminToken),
      { params: Promise.resolve({ patientId: 'PX-9402' }) }
    );
    const body: any = await response.json();
    const passed = response.status === 200 && body.data?.patient?.patientId === 'PX-9402';
    return {
      passed,
      details: `status=${response.status}, patient=${body.data?.patient?.patientId}, keys=${Object.keys(body.data || {}).join(',')}`,
    };
  });

  await finish(results);
}

async function finish(results: TestResult[]): Promise<void> {
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  console.log(`\n${'='.repeat(78)}`);
  console.log(`RESULT: ${passed}/${results.length} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailed checks:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => console.log(` - [${r.num}] ${r.name}: ${r.details}`));
    process.exitCode = 1;
  }
  console.log('='.repeat(78));
}

main().catch((error) => {
  console.error('\n❌ Phase Three validation suite crashed:', error);
  process.exit(1);
});


