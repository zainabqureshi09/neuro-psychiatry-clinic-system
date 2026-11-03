import { getSupabaseClient } from '../supabase';
import Patient from '@/models/Patient';
import Appointment from '@/models/Appointment';
import Consultation from '@/models/Consultation';
import Prescription from '@/models/Prescription';
import FollowUp from '@/models/FollowUp';

export interface PracticeReport {
  summary: {
    totalPatients: number;
    newPatients: number;
    todayAppointments: number;
    monthlyAppointments: number;
    completedAppointments: number;
    cancelledAppointments: number;
    totalAppointments: number;
    totalConsultations: number;
    totalPrescriptions: number;
  };
  followUps: Record<string, number>;
  genderBreakdown: Array<{ gender: string; count: number }>;
  statusBreakdown: Array<{ status: string; count: number }>;
}

function tally(values: Array<string | null | undefined>): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    const key = value || 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

/**
 * Practice analytics used by GET /api/reports on both APIs.
 * Uses Supabase head-count queries (cheap) plus lightweight column scans for
 * the breakdowns; falls back to MongoDB aggregations when PostgreSQL is not
 * configured.
 */
export async function getPracticeReport(): Promise<PracticeReport> {
  const todayStr = new Date().toISOString().split('T')[0];
  const currentYearMonth = todayStr.slice(0, 7);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

  const supabase = getSupabaseClient();

  if (supabase) {
    const countOf = async (table: string, build?: (query: any) => any): Promise<number> => {
      let query = supabase.from(table).select('*', { count: 'exact', head: true });
      if (build) query = build(query);
      const { count, error } = await query;
      if (error) {
        throw new Error(`Database error counting ${table}: ${error.message}`);
      }
      return count || 0;
    };

    const [
      totalPatients,
      newPatients,
      todayAppointments,
      monthlyAppointments,
      completedAppointments,
      cancelledAppointments,
      totalAppointments,
      totalConsultations,
      totalPrescriptions,
    ] = await Promise.all([
      countOf('patients'),
      countOf('patients', (q) => q.gte('registered_date', thirtyDaysAgoStr)),
      countOf('appointments', (q) => q.eq('appointment_date', todayStr)),
      countOf('appointments', (q) => q.like('appointment_date', `${currentYearMonth}%`)),
      countOf('appointments', (q) => q.eq('status', 'Completed')),
      countOf('appointments', (q) => q.eq('status', 'Cancelled')),
      countOf('appointments'),
      countOf('consultations'),
      countOf('prescriptions'),
    ]);

    const [followUpRows, genderRows, statusRows] = await Promise.all([
      supabase.from('follow_ups').select('status'),
      supabase.from('patients').select('gender'),
      supabase.from('patients').select('status'),
    ]);

    if (followUpRows.error) {
      throw new Error(`Database error reading follow-up statuses: ${followUpRows.error.message}`);
    }
    if (genderRows.error) {
      throw new Error(`Database error reading patient genders: ${genderRows.error.message}`);
    }
    if (statusRows.error) {
      throw new Error(`Database error reading patient statuses: ${statusRows.error.message}`);
    }

    const followUpStats: Record<string, number> = {
      Due: 0,
      Upcoming: 0,
      Overdue: 0,
      Completed: 0,
    };

    for (const [rawStatus, count] of Object.entries(
      tally((followUpRows.data || []).map((row: any) => row.status))
    )) {
      const normalized = rawStatus.charAt(0).toUpperCase() + rawStatus.slice(1).toLowerCase();
      followUpStats[normalized] = (followUpStats[normalized] || 0) + count;
    }

    return {
      summary: {
        totalPatients,
        newPatients,
        todayAppointments,
        monthlyAppointments,
        completedAppointments,
        cancelledAppointments,
        totalAppointments,
        totalConsultations,
        totalPrescriptions,
      },
      followUps: followUpStats,
      genderBreakdown: Object.entries(
        tally((genderRows.data || []).map((row: any) => row.gender))
      ).map(([gender, count]) => ({ gender, count })),
      statusBreakdown: Object.entries(
        tally((statusRows.data || []).map((row: any) => row.status))
      ).map(([status, count]) => ({ status, count })),
    };
  }

  // Fallback: MongoDB (unchanged legacy aggregation logic)
  const [
    totalPatients,
    newPatientsCount,
    todayAppointmentsCount,
    monthlyAppointmentsCount,
    completedAppointmentsCount,
    cancelledAppointmentsCount,
    totalAppointmentsCount,
    totalConsultationsCount,
    totalPrescriptionsCount,
    followUpsAggregation,
    genderDistribution,
    patientStatusDistribution,
  ] = await Promise.all([
    Patient.countDocuments(),
    Patient.countDocuments({ registeredDate: { $gte: thirtyDaysAgoStr } }),
    Appointment.countDocuments({ appointmentDate: todayStr }),
    Appointment.countDocuments({ appointmentDate: { $regex: `^${currentYearMonth}` } }),
    Appointment.countDocuments({ status: 'Completed' } as any),
    Appointment.countDocuments({ status: 'Cancelled' } as any),
    Appointment.countDocuments(),
    Consultation.countDocuments(),
    Prescription.countDocuments(),
    FollowUp.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Patient.aggregate([{ $group: { _id: '$gender', count: { $sum: 1 } } }]),
    Patient.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  const followUpStats: Record<string, number> = {
    Due: 0,
    Upcoming: 0,
    Overdue: 0,
    Completed: 0,
  };

  followUpsAggregation.forEach((item: any) => {
    const key = item._id as string;
    if (key) {
      const normalized = key.charAt(0).toUpperCase() + key.slice(1).toLowerCase();
      followUpStats[normalized] = (followUpStats[normalized] || 0) + item.count;
    }
  });

  return {
    summary: {
      totalPatients,
      newPatients: newPatientsCount,
      todayAppointments: todayAppointmentsCount,
      monthlyAppointments: monthlyAppointmentsCount,
      completedAppointments: completedAppointmentsCount,
      cancelledAppointments: cancelledAppointmentsCount,
      totalAppointments: totalAppointmentsCount,
      totalConsultations: totalConsultationsCount,
      totalPrescriptions: totalPrescriptionsCount,
    },
    followUps: followUpStats,
    genderBreakdown: genderDistribution.map((g: any) => ({ gender: g._id, count: g.count })),
    statusBreakdown: patientStatusDistribution.map((s: any) => ({ status: s._id, count: s.count })),
  };
}
