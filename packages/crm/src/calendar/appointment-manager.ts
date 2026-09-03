import crypto from 'node:crypto';
import { InvariantViolationError, DEFAULT_OPERATIONAL_TIMEZONE } from '@dispar-flux/domain';
import {
  type Appointment,
  type CreateAppointmentInput,
  type UpdateAppointmentInput,
  type AppointmentStatus,
  type AppointmentReminder,
} from './types.js';
import {
  AppointmentConflictError,
  InvalidAppointmentTimeError,
} from '../errors.js';
import {
  validateTimezone,
  getOperationalDayBounds,
  formatInOperationalTimezone,
} from './timezone.js';

export class AppointmentManager {
  private readonly appointments = new Map<string, Appointment>();

  /**
   * Schedules an appointment associated with a contact and optionally a lead.
   * All dates, daily bounds, and reminders are interpreted in the Operational Timezone (ADR 0019).
   */
  scheduleAppointment(
    input: CreateAppointmentInput,
    checkConflicts = false
  ): Appointment {
    const title = input.title?.trim();
    if (!title) {
      throw new InvariantViolationError('Appointment title cannot be empty');
    }
    if (!input.organizationId) {
      throw new InvariantViolationError('Organization ID is required');
    }
    if (!input.contactId) {
      throw new InvariantViolationError('Contact ID is required');
    }

    if (!(input.scheduledStartTime instanceof Date) || isNaN(input.scheduledStartTime.getTime())) {
      throw new InvalidAppointmentTimeError('Valid scheduled start time is required');
    }
    if (!(input.scheduledEndTime instanceof Date) || isNaN(input.scheduledEndTime.getTime())) {
      throw new InvalidAppointmentTimeError('Valid scheduled end time is required');
    }

    if (input.scheduledEndTime.getTime() <= input.scheduledStartTime.getTime()) {
      throw new InvalidAppointmentTimeError('Appointment end time must be strictly after start time');
    }

    const timezone = input.timezone ?? DEFAULT_OPERATIONAL_TIMEZONE;
    validateTimezone(timezone);

    if (checkConflicts) {
      const conflicts = this.detectConflicts({
        ...input,
        id: input.id ?? 'temp',
        title,
        timezone,
        status: 'scheduled',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      if (conflicts.length > 0) {
        throw new AppointmentConflictError(
          `Appointment conflicts with ${conflicts.length} existing scheduled appointment(s): ${conflicts.map((c) => c.title).join(', ')}`
        );
      }
    }

    const now = new Date();
    const appointment: Appointment = {
      id: input.id ?? `apt-${crypto.randomUUID()}`,
      organizationId: input.organizationId,
      contactId: input.contactId,
      leadId: input.leadId,
      title,
      description: input.description?.trim(),
      scheduledStartTime: input.scheduledStartTime,
      scheduledEndTime: input.scheduledEndTime,
      status: 'scheduled',
      reminderMinutesBefore: input.reminderMinutesBefore ?? [15, 60],
      timezone,
      createdAt: now,
      updatedAt: now,
    };

    this.appointments.set(appointment.id, appointment);
    return appointment;
  }

  getAppointment(appointmentId: string): Appointment | undefined {
    return this.appointments.get(appointmentId);
  }

  listAppointments(organizationId: string): Appointment[] {
    const list: Appointment[] = [];
    for (const apt of this.appointments.values()) {
      if (apt.organizationId === organizationId) {
        list.push(apt);
      }
    }
    return list;
  }

  getAppointmentsForContact(contactId: string): Appointment[] {
    const list: Appointment[] = [];
    for (const apt of this.appointments.values()) {
      if (apt.contactId === contactId) {
        list.push(apt);
      }
    }
    return list;
  }

  getAppointmentsForLead(leadId: string): Appointment[] {
    const list: Appointment[] = [];
    for (const apt of this.appointments.values()) {
      if (apt.leadId === leadId) {
        list.push(apt);
      }
    }
    return list;
  }

  /**
   * Retrieves all appointments for a calendar day calculated in the Organization's Operational Timezone (ADR 0019).
   */
  getAppointmentsForDay(
    day: Date,
    organizationId: string,
    timezone = DEFAULT_OPERATIONAL_TIMEZONE
  ): Appointment[] {
    const bounds = getOperationalDayBounds(day, timezone);

    const list: Appointment[] = [];
    for (const apt of this.appointments.values()) {
      if (apt.organizationId !== organizationId) continue;
      if (apt.status === 'canceled') continue;

      // Check time overlap: (startA < endB) and (endA > startB)
      const overlaps =
        apt.scheduledStartTime.getTime() < bounds.endOfDay.getTime() &&
        apt.scheduledEndTime.getTime() > bounds.startOfDay.getTime();

      if (overlaps) {
        list.push(apt);
      }
    }

    return list.sort((a, b) => a.scheduledStartTime.getTime() - b.scheduledStartTime.getTime());
  }

  /**
   * Updates an appointment's status (scheduled, completed, canceled, no_show).
   */
  updateStatus(appointmentId: string, status: AppointmentStatus): Appointment {
    const apt = this.appointments.get(appointmentId);
    if (!apt) {
      throw new InvariantViolationError(`Appointment "${appointmentId}" not found`);
    }

    const updated: Appointment = {
      ...apt,
      status,
      updatedAt: new Date(),
    };
    this.appointments.set(appointmentId, updated);
    return updated;
  }

  /**
   * Updates general fields of an appointment.
   */
  updateAppointment(appointmentId: string, input: UpdateAppointmentInput): Appointment {
    const apt = this.appointments.get(appointmentId);
    if (!apt) {
      throw new InvariantViolationError(`Appointment "${appointmentId}" not found`);
    }

    const newStart = input.scheduledStartTime ?? apt.scheduledStartTime;
    const newEnd = input.scheduledEndTime ?? apt.scheduledEndTime;

    if (newEnd.getTime() <= newStart.getTime()) {
      throw new InvalidAppointmentTimeError('Appointment end time must be strictly after start time');
    }

    const updated: Appointment = {
      ...apt,
      title: input.title?.trim() || apt.title,
      description: input.description !== undefined ? input.description.trim() : apt.description,
      scheduledStartTime: newStart,
      scheduledEndTime: newEnd,
      status: input.status ?? apt.status,
      reminderMinutesBefore: input.reminderMinutesBefore ?? apt.reminderMinutesBefore,
      updatedAt: new Date(),
    };
    this.appointments.set(appointmentId, updated);
    return updated;
  }

  /**
   * Detects conflicts (overlapping times) with existing scheduled appointments.
   */
  detectConflicts(appointment: Appointment, existingAppointments?: Appointment[]): Appointment[] {
    const pool = existingAppointments ?? Array.from(this.appointments.values());
    const conflicts: Appointment[] = [];

    const startA = appointment.scheduledStartTime.getTime();
    const endA = appointment.scheduledEndTime.getTime();

    for (const candidate of pool) {
      if (candidate.id === appointment.id) continue;
      if (candidate.organizationId !== appointment.organizationId) continue;
      if (candidate.status !== 'scheduled') continue;

      const startB = candidate.scheduledStartTime.getTime();
      const endB = candidate.scheduledEndTime.getTime();

      // Check overlap: (startA < endB) and (endA > startB)
      if (startA < endB && endA > startB) {
        conflicts.push(candidate);
      }
    }

    return conflicts;
  }

  /**
   * Calculates reminder alerts for an appointment.
   * Interprets and formats scheduled times in the Organization's Operational Timezone (ADR 0019).
   */
  calculateReminders(appointment: Appointment): AppointmentReminder[] {
    const reminders: AppointmentReminder[] = [];
    if (!appointment.reminderMinutesBefore || appointment.reminderMinutesBefore.length === 0) {
      return reminders;
    }

    const formattedScheduledTime = formatInOperationalTimezone(
      appointment.scheduledStartTime,
      appointment.timezone,
      {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }
    );

    for (const minutes of appointment.reminderMinutesBefore) {
      const triggerAt = new Date(appointment.scheduledStartTime.getTime() - minutes * 60_000);
      const alertMessage =
        minutes >= 1440
          ? `Lembrete: "${appointment.title}" amanhã às ${formattedScheduledTime} (${appointment.timezone}).`
          : minutes >= 60
          ? `Lembrete: "${appointment.title}" em ${Math.round(minutes / 60)}h, às ${formattedScheduledTime} (${appointment.timezone}).`
          : `Lembrete: "${appointment.title}" em ${minutes} minutos, às ${formattedScheduledTime} (${appointment.timezone}).`;

      reminders.push({
        appointmentId: appointment.id,
        triggerAt,
        minutesBefore: minutes,
        alertMessage,
        formattedScheduledTime,
      });
    }

    return reminders.sort((a, b) => a.triggerAt.getTime() - b.triggerAt.getTime());
  }
}
