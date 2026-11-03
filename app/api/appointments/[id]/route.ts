import { NextResponse } from 'next/server';
import { authorizeUser } from '@/lib/permissions';
import { ensureDatabaseReady } from '@/lib/db';
import { normalizeDatabaseError } from '@/lib/db/errors';
import {
  getAppointmentById,
  updateAppointment,
  deleteAppointment,
} from '@/lib/db/repositories/appointmentRepository';
import { auditFromSession } from '@/lib/audit';

function formatAppointment(appointment: any) {
  return {
    ...appointment,
    id: appointment.appointmentId,
    date: appointment.appointmentDate,
    time: appointment.appointmentTime,
    type: appointment.appointmentType,
  };
}

// GET /api/appointments/[id]
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    const { id } = await params;
    await ensureDatabaseReady();

    const appointment = await getAppointmentById(id);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: 'Appointment not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: formatAppointment(appointment),
    });
  } catch (error: any) {
    console.error('Error fetching appointment:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to fetch appointment detail.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// PUT /api/appointments/[id] - Update status or appointment details
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    const { id } = await params;
    await ensureDatabaseReady();
    const body = await req.json();

    const updates: Record<string, any> = {
      updatedBy: auth.session?.userId || 'SYSTEM',
    };

    if (body.status) updates.status = body.status;
    if (body.notes !== undefined) updates.notes = body.notes;
    if (body.room !== undefined) updates.room = body.room;
    if (body.date) updates.appointmentDate = body.date;
    if (body.time) updates.appointmentTime = body.time;
    if (body.type) updates.appointmentType = body.type;

    const appointment = await updateAppointment(id, updates);

    if (!appointment) {
      return NextResponse.json(
        { success: false, error: 'Appointment not found' },
        { status: 404 }
      );
    }

    await auditFromSession(auth.session, {
      action: 'UPDATE',
      module: 'APPOINTMENTS',
      resourceType: 'APPOINTMENT',
      resourceId: appointment.appointmentId,
      patientRef: appointment.patientId,
      description: `Updated appointment ${appointment.appointmentId} to status ${appointment.status}`,
    });

    return NextResponse.json({
      success: true,
      data: formatAppointment(appointment),
      message: `Appointment ${appointment.appointmentId} updated to ${appointment.status}`,
    });
  } catch (error: any) {
    console.error('Error updating appointment:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to update appointment.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}

// DELETE /api/appointments/[id]
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await authorizeUser(['DOCTOR', 'RECEPTIONIST', 'ADMIN'], req);
    if (!auth.authorized) return auth.response!;

    const { id } = await params;
    await ensureDatabaseReady();

    const appointment = await getAppointmentById(id);
    if (!appointment) {
      return NextResponse.json(
        { success: false, error: 'Appointment not found' },
        { status: 404 }
      );
    }

    const deleted = await deleteAppointment(id);
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Failed to delete appointment.' },
        { status: 500 }
      );
    }

    await auditFromSession(auth.session, {
      action: 'DELETE',
      module: 'APPOINTMENTS',
      resourceType: 'APPOINTMENT',
      resourceId: appointment.appointmentId,
      patientRef: appointment.patientId,
      description: `Deleted appointment ${appointment.appointmentId} (${appointment.appointmentDate} ${appointment.appointmentTime})`,
    });

    return NextResponse.json({
      success: true,
      message: `Appointment ${appointment.appointmentId} deleted.`,
    });
  } catch (error: any) {
    console.error('Error deleting appointment:', error);
    const { statusCode, message } = normalizeDatabaseError(
      error,
      'Failed to delete appointment.'
    );
    return NextResponse.json({ success: false, error: message }, { status: statusCode });
  }
}
