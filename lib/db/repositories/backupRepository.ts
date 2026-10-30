import { getSupabaseClient } from '../supabase';
import BackupLog, { IBackupLogDoc } from '@/models/BackupLog';

export interface BackupLogRecord {
  id?: any;
  _id?: any;
  backupId: string;
  timestamp: string;
  fileName: string;
  fileSize: string;
  type: string;
  status: string;
  createdByName: string;
  createdAt?: string | Date;
}

export async function generateBackupId(): Promise<string> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { count } = await supabase.from('backup_logs').select('*', { count: 'exact', head: true });
    return `BKP-${100 + (count || 0) + 1}`;
  }

  const count = await BackupLog.countDocuments();
  return `BKP-${100 + count + 1}`;
}

export async function recordBackupLog(data: Partial<BackupLogRecord>): Promise<BackupLogRecord> {
  const backupId = data.backupId || (await generateBackupId());
  const timestamp = data.timestamp || new Date().toISOString();

  const supabase = getSupabaseClient();
  if (supabase) {
    const insertRow = {
      backup_id: backupId,
      timestamp,
      file_name: data.fileName || `backup-${Date.now()}.json`,
      file_size: data.fileSize || '0 KB',
      type: data.type || 'Full System',
      status: data.status || 'Completed',
      created_by_name: data.createdByName || 'Administrator',
    };

    const { data: created, error } = await supabase
      .from('backup_logs')
      .insert(insertRow)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to record backup log: ${error.message}`);
    }

    return {
      id: created.id,
      backupId: created.backup_id,
      timestamp: created.timestamp,
      fileName: created.file_name,
      fileSize: created.file_size,
      type: created.type,
      status: created.status,
      createdByName: created.created_by_name,
      createdAt: created.created_at,
    };
  }

  // Fallback: MongoDB
  const log = new BackupLog({
    ...data,
    backupId,
    timestamp,
  });

  await log.save();
  const obj: any = log.toObject ? log.toObject() : log;
  return {
    ...obj,
    id: obj.backupId || obj._id?.toString(),
  } as BackupLogRecord;
}

export async function listBackupLogs(limit: number = 20): Promise<BackupLogRecord[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase
      .from('backup_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Database error fetching backup logs: ${error.message}`);
    }

    return (data || []).map((row) => ({
      id: row.id,
      backupId: row.backup_id,
      timestamp: row.timestamp,
      fileName: row.file_name,
      fileSize: row.file_size,
      type: row.type,
      status: row.status,
      createdByName: row.created_by_name,
      createdAt: row.created_at,
    }));
  }

  // Fallback: MongoDB
  const docs = await BackupLog.find().sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map((d: any) => ({
    ...d,
    id: d.backupId || d._id?.toString(),
  }));
}
