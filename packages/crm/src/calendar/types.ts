export type AppointmentStatus = 'scheduled' | 'completed' | 'canceled' | 'no_show';

export interface Appointment {
  id: string;
  organizationId: string;
  contactId: string;
  leadId?: string;
  title: string;
  description?: string;
  scheduledStartTime: Date;
  scheduledEndTime: Date;
  status: AppointmentStatus;
  reminderMinutesBefore?: number[]; // e.g. [15, 60, 1440]
  timezone: string; // Operational timezone e.g. 'America/Sao_Paulo'
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAppointmentInput {
  id?: string;
  organizationId: string;
  contactId: string;
  leadId?: string;
  title: string;
  description?: string;
  scheduledStartTime: Date;
  scheduledEndTime: Date;
  reminderMinutesBefore?: number[];
  timezone?: string; // Defaults to organization's operational timezone (e.g. 'America/Sao_Paulo')
}

export interface UpdateAppointmentInput {
  title?: string;
  description?: string;
  scheduledStartTime?: Date;
  scheduledEndTime?: Date;
  status?: AppointmentStatus;
  reminderMinutesBefore?: number[];
}

export interface AppointmentReminder {
  appointmentId: string;
  triggerAt: Date;
  minutesBefore: number;
  alertMessage: string;
  formattedScheduledTime: string;
}
