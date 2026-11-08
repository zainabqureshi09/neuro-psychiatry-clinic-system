import { getSupabaseClient } from '../supabase';
import { getPostgresPool } from '../postgres';
import { mapAuditLogFromPg } from '../mapper';
import AuditLog, { IAuditLogDoc } from '@/models/AuditLog';

export interface AuditLogRecord {
  id: string;
  _id?: any;
  logId: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: string;
  action: string;
  module: string;
  resourceType?: string;
  resourceId?: string;
  patientRef?: string;
  description: string;
  metadata?: Record<string, any>;
  createdAt?: string | Date;
}

let seqInitPromise: Promise<void> | null = null;

async function ensureAuditLogSequence(): Promise<void> {
  const pool = getPostgresPool();
  if (!pool) return;
  if (!seqInitPromise) {
    seqInitPromise = (async () => {
      await pool.query(`
        SELECT setval(
          'audit_logs_seq',
          GREATEST(
            (SELECT COALESCE(last_value, 8900) FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'audit_logs_seq'),
            (SELECT COALESCE(MAX(NULLIF(regexp_replace(log_id, '^LOG-', ''), '')::bigint), 8900) FROM audit_logs WHERE log_id ~ '^LOG-[0-9]+$'),
            8900
          ),
          true
        );
      `);
    })().catch((err) => {
      seqInitPromise = null;
      console.warn('[AuditLog] Warning initializing audit_logs_seq:', err.message);
    });
  }
  return seqInitPromise;
}

export async function generateAuditLogId(): Promise<string> {
  const pool = getPostgresPool();
  if (pool) {
    try {
      await ensureAuditLogSequence();
      const res = await pool.query("SELECT nextval('audit_logs_seq') as seq");
      if (res.rows && res.rows[0]?.seq) {
        return `LOG-${res.rows[0].seq}`;
      }
    } catch (err: any) {
      console.warn('[AuditLog] Sequence nextval failed, falling back to query:', err.message);
    }
  }

  const supabase = getSupabaseClient();
  if (supabase) {
    const [{ count }, { data }] = await Promise.all([
      supabase.from('audit_logs').select('*', { count: 'exact', head: true }),
      supabase.from('audit_logs').select('log_id').order('created_at', { ascending: false }).limit(50),
    ]);
    let maxNum = 8900 + (count || 0);
    if (data && data.length > 0) {
      for (const row of data) {
        const match = typeof row.log_id === 'string' ? row.log_id.match(/^LOG-(\d+)$/) : null;
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > maxNum) maxNum = num;
        }
      }
    }
    return `LOG-${maxNum + 1}`;
  }

  try {
    const last = await AuditLog.findOne({ logId: /^LOG-\d+$/ }).sort({ createdAt: -1 });
    let maxNum = 8900;
    if (last && last.logId) {
      const match = last.logId.match(/^LOG-(\d+)$/);
      if (match) maxNum = parseInt(match[1], 10);
    }
    return `LOG-${maxNum + 1}`;
  } catch {
    const count = await AuditLog.countDocuments();
    return `LOG-${8900 + count + 1}`;
  }
}

/**
 * Records an audit log event without blocking user flow.
 */
export async function recordAuditEvent(event: {
  userId: string;
  userName?: string;
  userRole?: string;
  action: string;
  module: string;
  resourceType?: string;
  resourceId?: string;
  patientRef?: string;
  description: string;
  metadata?: Record<string, any>;
}): Promise<AuditLogRecord | null> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const timestamp = new Date().toISOString();
      const logId = await generateAuditLogId();

      const supabase = getSupabaseClient();
      if (supabase) {
        const insertRow = {
          log_id: logId,
          timestamp,
          user_id: event.userId,
          user_name: event.userName || 'System',
          user_role: event.userRole || 'SYSTEM',
          action: event.action,
          module: event.module,
          resource_type: event.resourceType || '',
          resource_id: event.resourceId || '',
          patient_ref: event.patientRef || '',
          description: event.description,
          metadata: event.metadata || {},
        };

        const { data, error } = await supabase
          .from('audit_logs')
          .insert(insertRow)
          .select('*')
          .single();

        if (error) {
          if (error.code === '23505' && attempt < maxAttempts) {
            seqInitPromise = null;
            continue;
          }
          console.error('[AuditLog] Notice: could not record audit event:', error.message);
          return null;
        }
        return mapAuditLogFromPg(data);
      }

      // Fallback: MongoDB
      const log = new AuditLog({
        logId,
        timestamp,
        userId: event.userId,
        userName: event.userName || 'System',
        userRole: event.userRole || 'SYSTEM',
        action: event.action,
        module: event.module,
        resourceType: event.resourceType || '',
        resourceId: event.resourceId || '',
        patientRef: event.patientRef || '',
        description: event.description,
        metadata: event.metadata || {},
      });

      await log.save();
      const obj: any = log.toObject ? log.toObject() : log;
      return {
        ...obj,
        id: obj.logId || obj._id?.toString(),
      } as AuditLogRecord;
    } catch (err: any) {
      if (err.code === 11000 && attempt < maxAttempts) {
        continue;
      }
      console.error('[AuditLog] Non-blocking audit error:', err.message || err);
      return null;
    }
  }
  return null;
}

export async function listAuditLogs(filter: {
  userId?: string;
  userRole?: string;
  module?: string;
  action?: string;
  patientRef?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{ data: AuditLogRecord[]; total: number; page: number; limit: number }> {
  const page = filter.page || 1;
  const limit = Math.min(filter.limit || 50, 200);

  const supabase = getSupabaseClient();
  if (supabase) {
    let query = supabase.from('audit_logs').select('*', { count: 'exact' });

    if (filter.userId) query = query.eq('user_id', filter.userId);
    if (filter.userRole) query = query.eq('user_role', filter.userRole);
    if (filter.module) query = query.eq('module', filter.module);
    if (filter.action) query = query.eq('action', filter.action);
    if (filter.patientRef) query = query.eq('patient_ref', filter.patientRef);
    if (filter.search) {
      const term = filter.search;
      query = query.or(
        `log_id.ilike.%${term}%,description.ilike.%${term}%,user_name.ilike.%${term}%,user_id.ilike.%${term}%,patient_ref.ilike.%${term}%`
      );
    }
    if (filter.startDate) query = query.gte('created_at', filter.startDate);
    if (filter.endDate) {
      query = query.lte('created_at', `${filter.endDate}T23:59:59.999Z`);
    }

    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.order('created_at', { ascending: false }).range(from, to);

    const { data, count, error } = await query;
    if (error) {
      throw new Error(`Database error querying audit logs: ${error.message}`);
    }

    const mapped = (data || []).map(mapAuditLogFromPg);
    return {
      data: mapped,
      total: count || mapped.length,
      page,
      limit,
    };
  }

  // Fallback: MongoDB
  const mongoFilter: any = {};
  if (filter.userId) mongoFilter.userId = filter.userId;
  if (filter.userRole) mongoFilter.userRole = filter.userRole;
  if (filter.module) mongoFilter.module = filter.module;
  if (filter.action) mongoFilter.action = filter.action;
  if (filter.patientRef) mongoFilter.patientRef = filter.patientRef;
  if (filter.search) {
    const searchRegex = new RegExp(filter.search, 'i');
    mongoFilter.$or = [
      { logId: searchRegex },
      { description: searchRegex },
      { userName: searchRegex },
      { userId: searchRegex },
      { patientRef: searchRegex },
    ];
  }
  if (filter.startDate || filter.endDate) {
    mongoFilter.createdAt = {};
    if (filter.startDate) mongoFilter.createdAt.$gte = new Date(filter.startDate);
    if (filter.endDate) {
      const toDate = new Date(filter.endDate);
      toDate.setHours(23, 59, 59, 999);
      mongoFilter.createdAt.$lte = toDate;
    }
  }

  const total = await AuditLog.countDocuments(mongoFilter);
  const skip = (page - 1) * limit;
  const docs = await AuditLog.find(mongoFilter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const formatted = docs.map((d: any) => ({
    ...d,
    id: d.logId || d._id?.toString(),
  }));

  return {
    data: formatted,
    total,
    page,
    limit,
  };
}
