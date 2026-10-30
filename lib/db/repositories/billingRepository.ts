import { getSupabaseClient } from '../supabase';
import { withTransaction, getPostgresPool } from '../postgres';
import { mapPaymentFromPg, mapFeeCategoryFromPg } from '../mapper';
import Payment, { IPaymentDoc } from '@/models/Payment';
import FeeCategory, { IFeeCategoryDoc } from '@/models/FeeCategory';
import Patient from '@/models/Patient';

export interface FeeCategoryRecord {
  id: string;
  _id?: any;
  categoryId: string;
  name: string;
  defaultFee: number;
  amount?: number;
  description?: string;
  isActive: boolean;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

export interface PaymentRecord {
  id: string;
  _id?: any;
  paymentId: string;
  receiptNumber: string;
  patientId: string;
  patientName: string;
  appointmentId?: string;
  consultationId?: string;
  feeCategoryId?: string;
  service: string;
  feeCategory?: string;
  amount: number;
  paymentMethod: string;
  paymentStatus: string;
  date: string;
  paymentDate?: string;
  notes?: string;
  receivedBy?: string;
  createdBy?: string;
  updatedBy?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
}

// ==============================================================================
// FEE CATEGORIES
// ==============================================================================

export async function getFeeCategories(): Promise<FeeCategoryRecord[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { data, error } = await supabase.from('fee_categories').select('*').order('created_at', { ascending: true });
    if (error) {
      throw new Error(`Database error fetching fee categories: ${error.message}`);
    }
    return (data || []).map(mapFeeCategoryFromPg);
  }

  // Fallback: MongoDB
  const docs = await FeeCategory.find().sort({ createdAt: 1 }).lean();
  return docs.map((d: any) => ({
    ...d,
    id: d.categoryId || d._id?.toString(),
    defaultFee: d.defaultFee || d.amount || 0,
    amount: d.amount || d.defaultFee || 0,
  }));
}

export async function createFeeCategory(data: Partial<FeeCategoryRecord>): Promise<FeeCategoryRecord> {
  const supabase = getSupabaseClient();
  if (supabase) {
    let categoryId = data.categoryId;
    if (!categoryId) {
      const { count } = await supabase.from('fee_categories').select('*', { count: 'exact', head: true });
      categoryId = `FC-${100 + (count || 0) + 1}`;
    }

    const { data: created, error } = await supabase
      .from('fee_categories')
      .insert({
        category_id: categoryId,
        name: data.name,
        default_fee: data.defaultFee || data.amount || 0,
        amount: data.amount || data.defaultFee || 0,
        description: data.description || '',
        is_active: data.isActive !== undefined ? data.isActive : true,
        created_by: data.createdBy || '',
        updated_by: data.updatedBy || '',
      })
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to create fee category: ${error.message}`);
    }
    return mapFeeCategoryFromPg(created);
  }

  // Fallback: MongoDB
  let categoryId = data.categoryId;
  if (!categoryId) {
    const count = await FeeCategory.countDocuments();
    categoryId = `FC-${100 + count + 1}`;
  }

  const newCat = new FeeCategory({
    ...data,
    categoryId,
    defaultFee: data.defaultFee || data.amount || 0,
    amount: data.amount || data.defaultFee || 0,
  });

  await newCat.save();
  const obj: any = newCat.toObject ? newCat.toObject() : newCat;
  return {
    ...obj,
    id: obj.categoryId || obj._id?.toString(),
  } as FeeCategoryRecord;
}

export async function updateFeeCategory(id: string, updates: Partial<FeeCategoryRecord>): Promise<FeeCategoryRecord | null> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const updateRow: Record<string, any> = {};

    if (updates.name !== undefined) updateRow.name = updates.name;
    if (updates.defaultFee !== undefined) {
      updateRow.default_fee = updates.defaultFee;
      updateRow.amount = updates.defaultFee;
    }
    if (updates.amount !== undefined) {
      updateRow.amount = updates.amount;
      updateRow.default_fee = updates.amount;
    }
    if (updates.description !== undefined) updateRow.description = updates.description;
    if (updates.isActive !== undefined) updateRow.is_active = updates.isActive;

    let query = supabase.from('fee_categories').update(updateRow);
    if (isUuid) {
      query = query.or(`category_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('category_id', id);
    }

    const { data, error } = await query.select('*').maybeSingle();
    if (error) {
      throw new Error(`Failed to update fee category: ${error.message}`);
    }
    return mapFeeCategoryFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const cat = await FeeCategory.findOne({
    $or: [{ categoryId: id }, { _id: isValidObjectId ? id : null }],
  });

  if (!cat) return null;
  Object.assign(cat, updates);
  await cat.save();

  const obj: any = cat.toObject ? cat.toObject() : cat;
  return {
    ...obj,
    id: obj.categoryId || obj._id?.toString(),
  } as FeeCategoryRecord;
}

export async function deleteFeeCategory(id: string): Promise<boolean> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('fee_categories').delete();
    if (isUuid) {
      query = query.or(`category_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('category_id', id);
    }
    const { error } = await query;
    return !error;
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const result = await FeeCategory.deleteOne({
    $or: [{ categoryId: id }, { _id: isValidObjectId ? id : null }],
  });
  return (result.deletedCount || 0) > 0;
}

// ==============================================================================
// PAYMENTS & BILLING LEDGER
// ==============================================================================

export async function generateReceiptNumber(): Promise<string> {
  const currentYear = new Date().getFullYear();

  const supabase = getSupabaseClient();
  if (supabase) {
    const { count } = await supabase.from('payments').select('*', { count: 'exact', head: true });
    const receiptSeq = String((count || 0) + 101).padStart(4, '0');
    return `RCP-${currentYear}-${receiptSeq}`;
  }

  const count = await Payment.countDocuments();
  const receiptSeq = String(count + 101).padStart(4, '0');
  return `RCP-${currentYear}-${receiptSeq}`;
}

export async function generatePaymentId(): Promise<string> {
  const supabase = getSupabaseClient();
  if (supabase) {
    const { count } = await supabase.from('payments').select('*', { count: 'exact', head: true });
    return `PY-${400 + (count || 0) + 1}`;
  }

  const count = await Payment.countDocuments();
  return `PY-${400 + count + 1}`;
}

export async function getPayments(filter: {
  patientId?: string;
  date?: string;
  month?: string;
  status?: string;
} = {}): Promise<PaymentRecord[]> {
  const supabase = getSupabaseClient();
  if (supabase) {
    let query = supabase.from('payments').select('*');

    if (filter.patientId) query = query.eq('patient_id', filter.patientId);
    if (filter.date) query = query.eq('date', filter.date);
    if (filter.month) query = query.ilike('date', `${filter.month}%`);
    if (filter.status) query = query.ilike('payment_status', filter.status);

    query = query.order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) {
      throw new Error(`Database error querying payments: ${error.message}`);
    }
    return (data || []).map(mapPaymentFromPg);
  }

  // Fallback: MongoDB
  const mongoFilter: any = {};
  if (filter.patientId) mongoFilter.patientId = filter.patientId;
  if (filter.date) mongoFilter.date = filter.date;
  if (filter.month) mongoFilter.date = new RegExp(`^${filter.month}`);
  if (filter.status) mongoFilter.paymentStatus = new RegExp(`^${filter.status}$`, 'i');

  const docs = await Payment.find(mongoFilter).sort({ createdAt: -1 }).lean();
  return docs.map((d: any) => ({
    ...d,
    id: d.paymentId || d._id?.toString(),
  }));
}

export async function getPaymentById(id: string): Promise<PaymentRecord | null> {
  if (!id) return null;

  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    let query = supabase.from('payments').select('*');

    if (isUuid) {
      query = query.or(`payment_id.eq.${id},receipt_number.eq.${id},id.eq.${id}`);
    } else {
      query = query.or(`payment_id.eq.${id},receipt_number.eq.${id}`);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(`Database error fetching payment: ${error.message}`);
    }
    return mapPaymentFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const doc = await Payment.findOne({
    $or: [{ paymentId: id }, { receiptNumber: id }, { _id: isValidObjectId ? id : null }],
  }).lean();

  if (!doc) return null;
  return {
    ...doc,
    id: (doc as any).paymentId || (doc as any)._id?.toString(),
  } as PaymentRecord;
}

/**
 * Record a payment with strict receipt number generation and immutability.
 * Uses atomic transaction via PostgreSQL pg Pool where available.
 */
export async function recordPayment(data: Partial<PaymentRecord>): Promise<PaymentRecord> {
  const paymentId = data.paymentId || (await generatePaymentId());
  const receiptNumber = data.receiptNumber || (await generateReceiptNumber());
  const date = data.date || data.paymentDate || new Date().toISOString().split('T')[0];
  const amount = Number(data.amount);

  if (isNaN(amount) || amount <= 0) {
    throw new Error('Payment amount must be a positive monetary value (> 0).');
  }

  // Use PostgreSQL transaction if pool is available
  const pool = getPostgresPool();
  if (pool) {
    return withTransaction(async (client) => {
      const sql = `
        INSERT INTO payments (
          payment_id, receipt_number, patient_id, patient_name,
          appointment_id, consultation_id, fee_category_id,
          service, fee_category, amount, payment_method,
          payment_status, date, payment_date, notes,
          received_by, created_by, updated_by
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18
        ) RETURNING *;
      `;
      const values = [
        paymentId,
        receiptNumber,
        data.patientId,
        data.patientName,
        data.appointmentId || '',
        data.consultationId || '',
        data.feeCategoryId || null,
        data.service || 'Consultation Service',
        data.feeCategory || 'Consultation',
        amount,
        data.paymentMethod || 'Cash',
        data.paymentStatus || 'Paid',
        date,
        date,
        data.notes || '',
        data.receivedBy || '',
        data.createdBy || '',
        data.updatedBy || '',
      ];

      const res = await client.query(sql, values);
      return mapPaymentFromPg(res.rows[0]);
    });
  }

  // Supabase REST client fallback
  const supabase = getSupabaseClient();
  if (supabase) {
    const insertRow = {
      payment_id: paymentId,
      receipt_number: receiptNumber,
      patient_id: data.patientId,
      patient_name: data.patientName,
      appointment_id: data.appointmentId || '',
      consultation_id: data.consultationId || '',
      fee_category_id: data.feeCategoryId || null,
      service: data.service || 'Consultation Service',
      fee_category: data.feeCategory || 'Consultation',
      amount,
      payment_method: data.paymentMethod || 'Cash',
      payment_status: data.paymentStatus || 'Paid',
      date,
      payment_date: date,
      notes: data.notes || '',
      received_by: data.receivedBy || '',
      created_by: data.createdBy || '',
      updated_by: data.updatedBy || '',
    };

    const { data: created, error } = await supabase
      .from('payments')
      .insert(insertRow)
      .select('*')
      .single();

    if (error) {
      throw new Error(`Failed to record payment: ${error.message}`);
    }
    return mapPaymentFromPg(created);
  }

  // Fallback: MongoDB
  const newPayment = new Payment({
    ...data,
    paymentId,
    receiptNumber,
    amount,
    date,
    paymentDate: date,
  });

  await newPayment.save();
  const obj: any = newPayment.toObject ? newPayment.toObject() : newPayment;
  return {
    ...obj,
    id: obj.paymentId || obj._id?.toString(),
  } as PaymentRecord;
}

/**
 * Updates a payment record while strictly enforcing receipt number immutability.
 */
export async function updatePayment(
  id: string,
  updates: Partial<PaymentRecord>
): Promise<PaymentRecord | null> {
  // CRITICAL SECURITY RULE: receiptNumber is strictly immutable!
  const sanitized = { ...updates };
  delete (sanitized as any).receiptNumber;
  delete (sanitized as any).receipt_number;
  delete (sanitized as any).paymentId;
  delete (sanitized as any).payment_id;
  delete (sanitized as any)._id;
  delete (sanitized as any).id;

  const supabase = getSupabaseClient();
  if (supabase) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    const updateRow: Record<string, any> = {};

    if (sanitized.amount !== undefined) updateRow.amount = Number(sanitized.amount);
    if (sanitized.service !== undefined) updateRow.service = sanitized.service;
    if (sanitized.feeCategory !== undefined) updateRow.fee_category = sanitized.feeCategory;
    if (sanitized.paymentMethod !== undefined) updateRow.payment_method = sanitized.paymentMethod;
    if (sanitized.paymentStatus !== undefined) updateRow.payment_status = sanitized.paymentStatus;
    if (sanitized.notes !== undefined) updateRow.notes = sanitized.notes;
    if (sanitized.updatedBy !== undefined) updateRow.updated_by = sanitized.updatedBy;

    let query = supabase.from('payments').update(updateRow);
    if (isUuid) {
      query = query.or(`payment_id.eq.${id},id.eq.${id}`);
    } else {
      query = query.eq('payment_id', id);
    }

    const { data, error } = await query.select('*').maybeSingle();
    if (error) {
      throw new Error(`Failed to update payment: ${error.message}`);
    }
    return mapPaymentFromPg(data);
  }

  // Fallback: MongoDB
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id);
  const payment = await Payment.findOne({
    $or: [{ paymentId: id }, { receiptNumber: id }, { _id: isValidObjectId ? id : null }],
  });

  if (!payment) return null;
  Object.assign(payment, sanitized);
  await payment.save();

  const obj: any = payment.toObject ? payment.toObject() : payment;
  return {
    ...obj,
    id: obj.paymentId || obj._id?.toString(),
  } as PaymentRecord;
}

// ==============================================================================
// FINANCIAL COLLECTION REPORTS
// ==============================================================================

export async function getDailyFinancialReport(date: string): Promise<{
  date: string;
  totalCollected: number;
  paymentCount: number;
  methodBreakdown: Record<string, number>;
  categoryBreakdown: Record<string, number>;
  payments: PaymentRecord[];
}> {
  const targetDate = date || new Date().toISOString().split('T')[0];

  const payments = await getPayments({ date: targetDate, status: 'Paid' });
  const totalCollected = payments.reduce((acc, p) => acc + p.amount, 0);

  const methodBreakdown: Record<string, number> = {};
  const categoryBreakdown: Record<string, number> = {};

  payments.forEach((p) => {
    const method = p.paymentMethod || 'Other';
    const cat = p.feeCategory || 'Consultation';
    methodBreakdown[method] = (methodBreakdown[method] || 0) + p.amount;
    categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + p.amount;
  });

  return {
    date: targetDate,
    totalCollected,
    paymentCount: payments.length,
    methodBreakdown,
    categoryBreakdown,
    payments,
  };
}

export async function getMonthlyFinancialReport(year: string, month: string): Promise<{
  year: string;
  month: string;
  period: string;
  totalCollected: number;
  paymentCount: number;
  dailyTotals: Record<string, { total: number; count: number }>;
}> {
  let m = month;
  if (m.length === 1) m = `0${m}`;
  const period = `${year}-${m}`;

  const payments = await getPayments({ month: period, status: 'Paid' });
  const totalCollected = payments.reduce((acc, p) => acc + p.amount, 0);

  const dailyTotals: Record<string, { total: number; count: number }> = {};
  payments.forEach((p) => {
    const d = p.date;
    if (!dailyTotals[d]) {
      dailyTotals[d] = { total: 0, count: 0 };
    }
    dailyTotals[d].total += p.amount;
    dailyTotals[d].count += 1;
  });

  return {
    year,
    month: m,
    period,
    totalCollected,
    paymentCount: payments.length,
    dailyTotals,
  };
}
