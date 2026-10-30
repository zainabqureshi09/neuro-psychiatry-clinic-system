import { getSupabaseClient } from '../supabase';
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

export async function generateAuditLogId(): Promise<string> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { count } = await supabase.from('audit_logs').select('*', { count: 'exact', head: true });
    return `LOG-${8900 + (count || 0) + 1}`;
  }

  const count = await AuditLog.countDocuments();
  return `LOG-${8900 + count + 1}`;
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
    console.error('[AuditLog] Non-blocking audit error:', err.message || err);
    return null;
  }
}

export async function listAuditLogs(filter: {
  userId?: string;
  module?: string;
  action?: string;
  patientRef?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{ data: AuditLogRecord[]; total: number; page: number; limit: number }> {
  const page = filter.page || 1;
  const limit = Math.min(filter.limit || 50, 100);

  const supabase = getSupabaseClient();
  if (supabase) {
    let query = supabase.from('audit_logs').select('*', { count: 'exact' });

    if (filter.userId) query = query.eq('user_id', filter.userId);
    if (filter.module) query = query.eq('module', filter.module);
    if (filter.action) query = query.eq('action', filter.action);
    if (filter.patientRef) query = query.eq('patient_ref', filter.patientRef);

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
  if (filter.module) mongoFilter.module = filter.module;
  if (filter.action) mongoFilter.action = filter.action;
  if (filter.patientRef) mongoFilter.patientRef = filter.patientRef;

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
