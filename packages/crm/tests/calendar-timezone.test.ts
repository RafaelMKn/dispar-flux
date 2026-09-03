import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AppointmentManager,
  getOperationalDayBounds,
  getOperationalDateParts,
  formatInOperationalTimezone,
  isWithinBusinessHours,
  InvalidAppointmentTimeError,
  AppointmentConflictError,
} from '../src/index.js';
import { InvariantViolationError } from '@dispar-flux/domain';

describe('CRM: Calendar & Appointments in Operational Timezone (ADR 0019)', () => {
  const orgId = 'org-crm-calendar';
  const tzSaoPaulo = 'America/Sao_Paulo';

  describe('Operational Timezone Calculations (ADR 0019)', () => {
    it('calculates operational day bounds accurately for America/Sao_Paulo (UTC-3)', () => {
      // 2026-09-03 15:00:00 UTC corresponds to 12:00:00 in America/Sao_Paulo (UTC-3)
      const refDate = new Date('2026-09-03T15:00:00.000Z');
      const bounds = getOperationalDayBounds(refDate, tzSaoPaulo);

      // Local midnight (00:00:00) in America/Sao_Paulo is 03:00:00 UTC on the same day
      assert.equal(bounds.startOfDay.toISOString(), '2026-09-03T03:00:00.000Z');

      // Local end of day (23:59:59.999) in America/Sao_Paulo is 02:59:59.999 UTC on the next day
      assert.equal(bounds.endOfDay.toISOString(), '2026-09-04T02:59:59.999Z');

      // Verify local parts in operational timezone
      const partsStart = getOperationalDateParts(bounds.startOfDay, tzSaoPaulo);
      assert.equal(partsStart.year, 2026);
      assert.equal(partsStart.month, 9);
      assert.equal(partsStart.day, 3);
      assert.equal(partsStart.hour, 0);
      assert.equal(partsStart.minute, 0);

      const partsEnd = getOperationalDateParts(bounds.endOfDay, tzSaoPaulo);
      assert.equal(partsEnd.year, 2026);
      assert.equal(partsEnd.month, 9);
      assert.equal(partsEnd.day, 3);
      assert.equal(partsEnd.hour, 23);
      assert.equal(partsEnd.minute, 59);
      assert.equal(partsEnd.second, 59);
    });

    it('works across different timezones independently of host environment', () => {
      const refDate = new Date('2026-09-03T12:00:00.000Z');

      // UTC
      const utcBnds = getOperationalDayBounds(refDate, 'UTC');
      assert.equal(utcBnds.startOfDay.toISOString(), '2026-09-03T00:00:00.000Z');
      assert.equal(utcBnds.endOfDay.toISOString(), '2026-09-03T23:59:59.999Z');

      // America/New_York (EDT = UTC-4 in September)
      const nyBnds = getOperationalDayBounds(refDate, 'America/New_York');
      assert.equal(nyBnds.startOfDay.toISOString(), '2026-09-03T04:00:00.000Z');
      assert.equal(nyBnds.endOfDay.toISOString(), '2026-09-04T03:59:59.999Z');
    });

    it('formats date and checks business hours in operational timezone', () => {
      // 2026-09-03 is a Thursday
      // 14:00:00 UTC = 11:00:00 in America/Sao_Paulo (within 08:00 - 18:00 business hours)
      const businessTime = new Date('2026-09-03T14:00:00.000Z');
      assert.equal(isWithinBusinessHours(businessTime, tzSaoPaulo, 8, 18), true);

      // 02:00:00 UTC = 23:00:00 on previous day in America/Sao_Paulo (outside business hours)
      const nightTime = new Date('2026-09-03T02:00:00.000Z');
      assert.equal(isWithinBusinessHours(nightTime, tzSaoPaulo, 8, 18), false);

      const formatted = formatInOperationalTimezone(businessTime, tzSaoPaulo);
      assert.ok(formatted.includes('03/09/2026'));
    });
  });

  describe('Appointment Scheduling & Conflict Detection', () => {
    it('schedules an appointment associated with contact and lead', () => {
      const manager = new AppointmentManager();

      // 14:00 to 15:00 Brasilia time (17:00 to 18:00 UTC)
      const start = new Date('2026-09-03T17:00:00.000Z');
      const end = new Date('2026-09-03T18:00:00.000Z');

      const apt = manager.scheduleAppointment({
        organizationId: orgId,
        contactId: 'cnt-10',
        leadId: 'lead-10',
        title: 'Reunião de Demonstração',
        description: 'Demonstrar nova funcionalidade de automação',
        scheduledStartTime: start,
        scheduledEndTime: end,
        reminderMinutesBefore: [15, 60],
        timezone: tzSaoPaulo,
      });

      assert.ok(apt.id);
      assert.equal(apt.title, 'Reunião de Demonstração');
      assert.equal(apt.contactId, 'cnt-10');
      assert.equal(apt.leadId, 'lead-10');
      assert.equal(apt.status, 'scheduled');
      assert.equal(apt.timezone, tzSaoPaulo);

      // Verify retrieval by contact and lead
      assert.equal(manager.getAppointmentsForContact('cnt-10').length, 1);
      assert.equal(manager.getAppointmentsForLead('lead-10').length, 1);
    });

    it('rejects invalid appointment time bounds', () => {
      const manager = new AppointmentManager();
      const start = new Date('2026-09-03T18:00:00.000Z');
      const end = new Date('2026-09-03T17:00:00.000Z'); // End before start!

      assert.throws(
        () => {
          manager.scheduleAppointment({
            organizationId: orgId,
            contactId: 'cnt-11',
            title: 'Reunião Inválida',
            scheduledStartTime: start,
            scheduledEndTime: end,
          });
        },
        InvalidAppointmentTimeError
      );

      // Rejects empty title
      assert.throws(
        () => {
          manager.scheduleAppointment({
            organizationId: orgId,
            contactId: 'cnt-11',
            title: '   ',
            scheduledStartTime: end,
            scheduledEndTime: start,
          });
        },
        InvariantViolationError
      );
    });

    it('detects overlapping appointment conflicts', () => {
      const manager = new AppointmentManager();

      // Apt 1: 14:00 - 15:00 local (17:00 - 18:00 UTC)
      const apt1 = manager.scheduleAppointment({
        organizationId: orgId,
        contactId: 'cnt-1',
        title: 'Reunião A',
        scheduledStartTime: new Date('2026-09-03T17:00:00.000Z'),
        scheduledEndTime: new Date('2026-09-03T18:00:00.000Z'),
        timezone: tzSaoPaulo,
      });

      // Apt 2: 14:30 - 15:30 local (17:30 - 18:30 UTC) - Overlaps!
      const conflicts = manager.detectConflicts({
        ...apt1,
        id: 'new-apt',
        scheduledStartTime: new Date('2026-09-03T17:30:00.000Z'),
        scheduledEndTime: new Date('2026-09-03T18:30:00.000Z'),
      });
      assert.equal(conflicts.length, 1);
      assert.equal(conflicts[0]?.id, apt1.id);

      // Strict conflict check throws on scheduling
      assert.throws(
        () => {
          manager.scheduleAppointment(
            {
              organizationId: orgId,
              contactId: 'cnt-2',
              title: 'Reunião Conflitante',
              scheduledStartTime: new Date('2026-09-03T17:30:00.000Z'),
              scheduledEndTime: new Date('2026-09-03T18:30:00.000Z'),
              timezone: tzSaoPaulo,
            },
            true // checkConflicts = true
          );
        },
        AppointmentConflictError
      );

      // Apt 3: 15:00 - 16:00 local (18:00 - 19:00 UTC) - Exact touch at boundary, no overlap
      const apt3 = manager.scheduleAppointment({
        organizationId: orgId,
        contactId: 'cnt-3',
        title: 'Reunião C',
        scheduledStartTime: new Date('2026-09-03T18:00:00.000Z'),
        scheduledEndTime: new Date('2026-09-03T19:00:00.000Z'),
        timezone: tzSaoPaulo,
      });
      assert.ok(apt3.id);
    });

    it('filters daily appointments within Operational Timezone bounds', () => {
      const manager = new AppointmentManager();

      // Apt on 2026-09-03 22:00 local in America/Sao_Paulo (2026-09-04 01:00 UTC)
      // Note: in UTC this is on Sept 4, but in America/Sao_Paulo it is on Sept 3!
      const lateApt = manager.scheduleAppointment({
        organizationId: orgId,
        contactId: 'cnt-late',
        title: 'Atendimento Noturno',
        scheduledStartTime: new Date('2026-09-04T01:00:00.000Z'),
        scheduledEndTime: new Date('2026-09-04T01:30:00.000Z'),
        timezone: tzSaoPaulo,
      });

      // Apt on 2026-09-04 09:00 local in America/Sao_Paulo (2026-09-04 12:00 UTC)
      const nextDayApt = manager.scheduleAppointment({
        organizationId: orgId,
        contactId: 'cnt-next',
        title: 'Reunião do Dia Seguinte',
        scheduledStartTime: new Date('2026-09-04T12:00:00.000Z'),
        scheduledEndTime: new Date('2026-09-04T12:30:00.000Z'),
        timezone: tzSaoPaulo,
      });

      // Query appointments for Sept 3 in America/Sao_Paulo
      const sept3Date = new Date('2026-09-03T15:00:00.000Z');
      const sept3List = manager.getAppointmentsForDay(sept3Date, orgId, tzSaoPaulo);

      assert.equal(sept3List.length, 1);
      assert.equal(sept3List[0]?.id, lateApt.id);

      // Query appointments for Sept 4 in America/Sao_Paulo
      const sept4Date = new Date('2026-09-04T15:00:00.000Z');
      const sept4List = manager.getAppointmentsForDay(sept4Date, orgId, tzSaoPaulo);

      assert.equal(sept4List.length, 1);
      assert.equal(sept4List[0]?.id, nextDayApt.id);
    });

    it('calculates reminders in the operational timezone', () => {
      const manager = new AppointmentManager();

      // 15:30 local Brasilia time (18:30 UTC)
      const startTime = new Date('2026-09-03T18:30:00.000Z');
      const apt = manager.scheduleAppointment({
        organizationId: orgId,
        contactId: 'cnt-rem',
        title: 'Apresentação Comercial',
        scheduledStartTime: startTime,
        scheduledEndTime: new Date('2026-09-03T19:30:00.000Z'),
        reminderMinutesBefore: [15, 60],
        timezone: tzSaoPaulo,
      });

      const reminders = manager.calculateReminders(apt);
      assert.equal(reminders.length, 2);

      // 60 minutes before
      assert.equal(reminders[0]?.minutesBefore, 60);
      assert.equal(reminders[0]?.triggerAt.toISOString(), '2026-09-03T17:30:00.000Z');
      assert.ok(reminders[0]?.alertMessage.includes('1h'));
      assert.ok(reminders[0]?.alertMessage.includes('15:30'));

      // 15 minutes before
      assert.equal(reminders[1]?.minutesBefore, 15);
      assert.equal(reminders[1]?.triggerAt.toISOString(), '2026-09-03T18:15:00.000Z');
      assert.ok(reminders[1]?.alertMessage.includes('15 minutos'));
    });
  });
});
