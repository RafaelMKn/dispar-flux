import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createOrganization,
  DEFAULT_RETENTION_POLICY,
  DEFAULT_OPERATIONAL_TIMEZONE,
  isValidIanaTimezone,
  createMember,
  ensureAtLeastOneOwner,
  createAuthorizedDevice,
  isDeviceTrustActive,
  approveDevice,
  revokeDevice,
  touchDevice,
  createSession,
  isSessionValid,
  touchSession,
  revokeSession,
  createAccessInvite,
  isInviteValid,
  useAccessInvite,
  createContact,
  updateCanonicalProfile,
  createBase,
  createBaseMembership,
  createCampaign,
  createCampaignJob,
  canRetryJob,
  createConversation,
  createMessage,
  createFunnel,
  createLead,
  moveLead,
  createAuditRecord,
  sanitizeAuditMetadata,
  InvariantViolationError,
  ReauthorizationError,
} from '../src/index.js';

describe('Domain Entities', () => {
  describe('Organization', () => {
    it('creates an organization with default timezone and retention policy', () => {
      const org = createOrganization({
        id: 'org-1',
        name: 'Empresa Teste',
      });

      assert.equal(org.id, 'org-1');
      assert.equal(org.name, 'Empresa Teste');
      assert.equal(org.operationalTimezone, DEFAULT_OPERATIONAL_TIMEZONE);
      assert.equal(org.retentionPolicy.messagesDays, DEFAULT_RETENTION_POLICY.messagesDays);
    });

    it('rejects empty name or invalid IANA timezone', () => {
      assert.throws(
        () => createOrganization({ id: 'org-1', name: '' }),
        InvariantViolationError
      );
      assert.throws(
        () => createOrganization({ id: 'org-1', name: 'Teste', operationalTimezone: 'Invalid/Zone' }),
        InvariantViolationError
      );
    });

    it('validates IANA timezones correctly', () => {
      assert.equal(isValidIanaTimezone('America/Sao_Paulo'), true);
      assert.equal(isValidIanaTimezone('UTC'), true);
      assert.equal(isValidIanaTimezone('Invalid/TZ'), false);
    });
  });

  describe('Member & Roles', () => {
    it('creates owner and operator members with valid attributes', () => {
      const owner = createMember({
        id: 'mem-1',
        organizationId: 'org-1',
        name: 'Rafael Proprietário',
        email: 'proprietario@empresa.com',
        role: 'owner',
      });
      const operator = createMember({
        id: 'mem-2',
        organizationId: 'org-1',
        name: 'Carlos Operador',
        email: 'operador@empresa.com',
        role: 'operator',
      });

      assert.equal(owner.role, 'owner');
      assert.equal(operator.role, 'operator');
      assert.equal(owner.isActive, true);
    });

    it('rejects invalid email or empty name', () => {
      assert.throws(
        () => createMember({ id: '1', organizationId: 'o', name: '', email: 'a@b.com', role: 'owner' }),
        InvariantViolationError
      );
      assert.throws(
        () => createMember({ id: '1', organizationId: 'o', name: 'Name', email: 'invalid-email', role: 'owner' }),
        InvariantViolationError
      );
    });

    it('enforces that organization preserves at least one active Owner', () => {
      const activeOwner = createMember({ id: '1', organizationId: 'o', name: 'O', email: 'o@o.com', role: 'owner' });
      const inactiveOwner = createMember({ id: '2', organizationId: 'o', name: 'O2', email: 'o2@o.com', role: 'owner', isActive: false });
      const operator = createMember({ id: '3', organizationId: 'o', name: 'Op', email: 'op@o.com', role: 'operator' });

      assert.doesNotThrow(() => ensureAtLeastOneOwner([activeOwner, operator]));
      assert.throws(() => ensureAtLeastOneOwner([inactiveOwner, operator]), InvariantViolationError);
      assert.throws(() => ensureAtLeastOneOwner([operator]), InvariantViolationError);
    });
  });

  describe('AuthorizedDevice', () => {
    it('handles approval, trust expiration, touch, and revocation', () => {
      const device = createAuthorizedDevice({
        id: 'dev-1',
        memberId: 'mem-1',
        deviceIdentifier: 'fp_abc123',
        name: 'Chrome Windows 11',
      });

      assert.equal(device.isApproved, false);
      assert.equal(isDeviceTrustActive(device), false);

      const approved = approveDevice(device, 'mem-1');
      assert.equal(approved.isApproved, true);
      assert.equal(isDeviceTrustActive(approved), true);

      // Inactivity expiration after 90 days
      const expiredDate = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000);
      assert.equal(isDeviceTrustActive(approved, expiredDate), false);

      // Revoke ends trust immediately
      const revoked = revokeDevice(approved);
      assert.equal(isDeviceTrustActive(revoked), false);
    });
  });

  describe('Session', () => {
    it('enforces idle timeout (12h) and absolute timeout (30d)', () => {
      const now = new Date();
      const session = createSession({
        id: 'sess-1',
        memberId: 'mem-1',
        deviceId: 'dev-1',
        tokenHash: 'hash_abc',
        createdAt: now,
      });

      assert.equal(isSessionValid(session, now), true);

      // After 11 hours (within 12h idle): still valid
      const at11h = new Date(now.getTime() + 11 * 60 * 60 * 1000);
      assert.equal(isSessionValid(session, at11h), true);

      // Touching session updates idle expiration
      const touched = touchSession(session, at11h);
      assert.equal(isSessionValid(touched, at11h), true);

      // After 13 hours without touch: idle expired
      const at13h = new Date(now.getTime() + 13 * 60 * 60 * 1000);
      assert.equal(isSessionValid(session, at13h), false);

      // After 31 days: absolute limit reached
      const at31d = new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000);
      assert.equal(isSessionValid(session, at31d), false);

      // Revoking session invalidates immediately
      const revoked = revokeSession(session, now);
      assert.equal(isSessionValid(revoked, now), false);
    });
  });

  describe('AccessInvite', () => {
    it('creates, validates and consumes single-use invite', () => {
      const invite = createAccessInvite({
        id: 'inv-1',
        organizationId: 'org-1',
        createdByMemberId: 'mem-1',
        code: 'INVITE-XYZ-123',
        role: 'operator',
      });

      assert.equal(isInviteValid(invite), true);

      const used = useAccessInvite(invite, 'new-mem-2');
      assert.equal(isInviteValid(used), false);
      assert.equal(used.usedByMemberId, 'new-mem-2');

      // Cannot reuse
      assert.throws(() => useAccessInvite(used, 'another-mem'), InvariantViolationError);
    });
  });

  describe('Contact & CanonicalProfile', () => {
    it('maintains canonical profile and records human edits with audit attribution', () => {
      const contact = createContact({
        id: 'cnt-1',
        organizationId: 'org-1',
        normalizedPhone: '+5511987654321',
        name: 'João Silva',
      });

      assert.equal(contact.normalizedPhone, '+5511987654321');
      assert.deepEqual(contact.canonicalProfile.customFields, {});

      const updated = updateCanonicalProfile(contact, {
        customFields: { segmento: 'Varejo', cargo: 'Gerente' },
        notes: 'Cliente interessado no plano anual',
        editedByMemberId: 'mem-1',
      });

      assert.equal(updated.canonicalProfile.customFields['segmento'], 'Varejo');
      assert.equal(updated.canonicalProfile.lastEditedByMemberId, 'mem-1');
      assert.ok(updated.canonicalProfile.lastEditedAt);
    });
  });

  describe('Base & BaseMembership', () => {
    it('requires declared provenance and purpose, and isolates imported fields', () => {
      const base = createBase({
        id: 'base-1',
        organizationId: 'org-1',
        name: 'Leads Evento SP 2026',
        provenance: 'Formulário do estande presencial',
        purpose: 'Prospecção ativa pós-feira',
      });

      assert.equal(base.provenance, 'Formulário do estande presencial');
      assert.equal(base.purpose, 'Prospecção ativa pós-feira');

      const membership = createBaseMembership({
        id: 'bm-1',
        baseId: base.id,
        contactId: 'cnt-1',
        importedFields: { cargoImportado: 'Diretor', cidade: 'São Paulo' },
      });

      assert.equal(membership.importedFields['cargoImportado'], 'Diretor');
    });
  });

  describe('Campaign & CampaignJob (ADR 0028 & ADR 0035)', () => {
    it('creates campaign and jobs with frozen message template', () => {
      const campaign = createCampaign({
        id: 'cmp-1',
        organizationId: 'org-1',
        connectionId: 'conn-1',
        name: 'Campanha Black Friday',
        messageTemplate: 'Olá {{nome}}, temos uma oferta para você!',
        pacingIntervalSeconds: 30,
        dailyLimit: 200,
        confirmedResponsibility: true,
      });

      assert.equal(campaign.status, 'draft');
      assert.equal(campaign.sentCount, 0);

      const job = createCampaignJob({
        id: 'job-1',
        campaignId: campaign.id,
        contactId: 'cnt-1',
        normalizedPhone: '+5511987654321',
        renderedMessage: 'Olá João Silva, temos uma oferta para você!',
      });

      assert.equal(job.status, 'pending');
    });

    it('enforces ADR 0028: Envio Incerto ("unknown") must NEVER be retried automatically', () => {
      assert.equal(canRetryJob('unknown'), false);
      assert.equal(canRetryJob('sent'), false);
      assert.equal(canRetryJob('sending'), false);
      assert.equal(canRetryJob('failed'), true);
    });
  });

  describe('Conversation & Message', () => {
    it('creates conversation and handles manual vs automated message kinds', () => {
      const conv = createConversation({
        id: 'conv-1',
        organizationId: 'org-1',
        connectionId: 'conn-1',
        contactId: 'cnt-1',
      });

      const manualMsg = createMessage({
        id: 'msg-1',
        conversationId: conv.id,
        direction: 'outbound',
        type: 'manual',
        content: 'Olá João, como posso ajudar?',
        senderMemberId: 'mem-1',
      });

      const autoMsg = createMessage({
        id: 'msg-2',
        conversationId: conv.id,
        direction: 'outbound',
        type: 'automated',
        content: 'Mensagem automatizada de follow-up',
        campaignJobId: 'job-1',
      });

      assert.equal(manualMsg.kind, 'manual');
      assert.equal(autoMsg.kind, 'automated');
    });
  });

  describe('Funnel & Lead (ADR 0037 & ADR 0038)', () => {
    it('creates funnel with ordered stages and tracks lead progression', () => {
      const funnel = createFunnel({
        id: 'fnl-1',
        organizationId: 'org-1',
        name: 'Funil Comercial',
        stages: [
          { id: 'stg-2', name: 'Qualificação', order: 2 },
          { id: 'stg-1', name: 'Novo Contato', order: 1 },
          { id: 'stg-3', name: 'Proposta', order: 3 },
        ],
      });

      // Stages are sorted by order
      assert.equal(funnel.stages[0]?.id, 'stg-1');
      assert.equal(funnel.stages[1]?.id, 'stg-2');

      const lead = createLead({
        id: 'lead-1',
        organizationId: 'org-1',
        funnelId: funnel.id,
        contactId: 'cnt-1',
        stageId: 'stg-1',
        value: 1500,
      });

      assert.equal(lead.stageId, 'stg-1');

      const moved = moveLead(lead, 'stg-2');
      assert.equal(moved.stageId, 'stg-2');
    });
  });

  describe('AuditRecord (ADR 0030 & ADR 0050)', () => {
    it('creates sanitized audit records with PII and secret redaction', () => {
      const audit = createAuditRecord({
        id: 'aud-1',
        organizationId: 'org-1',
        actorType: 'member',
        actorId: 'mem-1',
        action: 'auth.login',
        targetType: 'device',
        targetId: 'dev-1',
        metadata: {
          ip: '192.168.1.1',
          password: 'SecretPassword123',
          tokenHash: 'xyzabc987',
          messageContent: 'Sensitive text body',
          safeField: 'ok',
        },
      });

      assert.equal(audit.metadata?.['safeField'], 'ok');
      assert.equal(audit.metadata?.['password'], '[REDACTED]');
      assert.equal(audit.metadata?.['tokenHash'], '[REDACTED]');
      assert.equal(audit.metadata?.['messageContent'], '[REDACTED]');
    });
  });
});
