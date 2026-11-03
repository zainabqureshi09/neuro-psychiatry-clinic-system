import { NextResponse } from 'next/server';
import { AppointmentSchema } from '@/lib/validators';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import {
  listAppointments,
  createAppointment,
  checkClinicianConflict,
} from '@/lib/db/repositories/appointmentRepository';
import { getPatientById } from '@/lib/db/repositories/patientRepository';
import { auditFromSession } from '@/lib/audit';

/** Normalizes an appointment record for the frontend contract. */
function formatAppointment(appointment: any) {
  return {
    ...appointment,
    id: appointment.appointmentId,
    date: appointment.appointmentDate,
    time: appointment.appointmentTime,
    type: appointment.appointmentType,
  };
}

// GET /api/appointments - List appointments with filters
export async function GET(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'RECEPTION', 'ADMIN', 'THERAPIST'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const { searchParams } = new URL(req.url);
    const date = searchParams.get('date');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const doctorId =
      searchParams.get('doctorId') || searchParams.get('clinicianId') || searchParams.get('clinician');
    const patientId = searchParams.get('patientId');
    const status = searchParams.get('status');
    const type = searchParams.get('type') || searchParams.get('appointmentType');
    const search = searchParams.get('search');

    const todayStr = new Date().toISOString().split('T')[0];
    const filter: Parameters<typeof listAppointments>[0] = {
      patientId: patientId || undefined,
      doctorId: doctorId || undefined,
      date: date || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      status: status && status !== 'Today' && status !== 'Upcoming' ? status : undefined,
      type: type || undefined,
      search: search || undefined,
    };

    if (!date && !startDate && !endDate) {
      if (status === 'Today') {
        filter.date = todayStr;
      } else if (status === 'Upcoming') {
        filter.startDate = todayStr;
        filter.excludeStatuses = ['Completed', 'COMPLETED', 'Cancelled', 'CANCELLED'];
      }
    }

    const appointments = await listAppointments(filter);
    const formatted = appointments.map(formatAppointment);

    return NextResponse.json({
      success: true,
      count: formatted.length,
      data: formatted,
    });
  } catch (error: any) {
    console.error('Error fetching appointments:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error fetching appointments.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// POST /api/appointments - Book appointment with conflict detection
export async function POST(req: Request) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'RECEPTION', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    await ensureDatabaseReady();
    const body = await req.json();

    if (body.date && !body.appointmentDate) body.appointmentDate = body.date;
    if (body.time && !body.appointmentTime) body.appointmentTime = body.time;
    if (body.type && !body.appointmentType) body.appointmentType = body.type;

    const validation = AppointmentSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: validation.error.issues[0].message },
        { status: 400 }
      );
    }

    const appData = validation.data;

    // 1. Validate Patient
    const patient = await getPatientById(appData.patientId);
    if (!patient) {
      return NextResponse.json(
        { success: false, error: `Invalid patient data: Patient ${appData.patientId} not found.` },
        { status: 404 }
      );
    }

    // 2. Prevent double booking for the clinician, date & time (overlap aware)
    const conflict = await checkClinicianConflict(
      appData.doctorId,
      appData.appointmentDate,
      appData.appointmentTime,
      appData.durationMinutes || 45
    );

    if (conflict) {
      return NextResponse.json(
        {
          success: false,
          error: `Time slot conflict: Doctor ${appData.doctorName} is already booked on ${appData.appointmentDate} at ${appData.appointmentTime}.`,
        },
        { status: 409 }
      );
    }

    const created = await createAppointment({
      ...appData,
      patientId: patient.patientId,
      patientName: patient.fullName,
      patientPhone: patient.phone,
      clinicianId: appData.doctorId,
      clinicianName: appData.doctorName,
      createdBy: auth.session?.userId || 'SYSTEM',
    });

    await auditFromSession(auth.session, {
      action: 'CREATE',
      module: 'APPOINTMENTS',
      resourceType: 'APPOINTMENT',
      resourceId: created.appointmentId,
      patientRef: patient.patientId,
      description: `Booked appointment ${created.appointmentId} for ${patient.fullName} on ${appData.appointmentDate} at ${appData.appointmentTime}`,
    });

    return NextResponse.json(
      {
        success: true,
        data: formatAppointment(created),
        message: `Appointment confirmed for ${patient.fullName} on ${appData.appointmentDate} at ${appData.appointmentTime}.`,
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('Error booking appointment:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Database error booking appointment.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
