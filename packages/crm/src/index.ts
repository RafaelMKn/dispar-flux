// Errors
export * from './errors.js';

// Funnel & Stage Management (ADR 0037)
export * from './funnel/types.js';
export * from './funnel/funnel-manager.js';

// Lead Management (ADR 0038)
export * from './lead/types.js';
export * from './lead/lead-manager.js';

// Response Attribution & Stage Progression (ADR 0042)
export * from './attribution/types.js';
export * from './attribution/response-attributor.js';

// Calendar & Appointments in Operational Timezone (ADR 0019)
export * from './calendar/types.js';
export * from './calendar/timezone.js';
export * from './calendar/appointment-manager.js';

// Follow-up Automation Pipeline (ADR 0027, ADR 0040, ADR 0043, ADR 0060)
export * from './follow-up/types.js';
export * from './follow-up/rule-engine.js';
export * from './follow-up/serial-automation-queue.js';

// SQLite Persistence
export * from './persistence/sqlite-crm-repository.js';
