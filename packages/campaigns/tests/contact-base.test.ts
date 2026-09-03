import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { InvariantViolationError, InvalidPhoneNumberError } from '@dispar-flux/domain';
import { ContactService } from '../src/contacts/contact-service.js';
import { BaseService } from '../src/bases/base-service.js';
import { createTestDatabase, type SeededTestContext } from './helpers/test-db.js';

describe('Canonical Contact & Base Management (ADR 0034, 0036, 0041)', () => {
  let ctx: SeededTestContext;
  let contactService: ContactService;
  let baseService: BaseService;

  beforeEach(() => {
    ctx = createTestDatabase();
    contactService = new ContactService(ctx.conn);
    baseService = new BaseService(ctx.conn);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('ContactService', () => {
    it('creates a new canonical contact with normalized E.164 phone (ADR 0034)', () => {
      // 10-digit Brazilian mobile missing 9th digit
      const result = contactService.findOrCreateContact(ctx.organizationId, {
        phone: '1198765432',
        name: 'Maria Silva',
      });

      assert.equal(result.isNew, true);
      assert.equal(result.contact.normalizedPhone, '+5511998765432');
      assert.equal(result.contact.name, 'Maria Silva');
      assert.equal(result.contact.organizationId, ctx.organizationId);
      assert.equal(result.contact.isOptedOut, false);
    });

    it('deduplicates contacts by normalized E.164 phone across the entire organization (ADR 0034)', () => {
      // First insertion with standard formatted number
      const first = contactService.findOrCreateContact(ctx.organizationId, {
        phone: '+55 (11) 98765-4321',
        name: 'Carlos Original',
      });
      assert.equal(first.isNew, true);

      // Second insertion with raw unformatted number
      const second = contactService.findOrCreateContact(ctx.organizationId, {
        phone: '11987654321',
        name: 'Carlos Duplicado',
      });

      assert.equal(second.isNew, false);
      assert.equal(second.contact.id, first.contact.id, 'Must reuse the exact same canonical contact ID');
      assert.equal(second.contact.normalizedPhone, '+5511987654321');
      // Invariant (ADR 0041): duplicate import must NOT overwrite canonical name!
      assert.equal(second.contact.name, 'Carlos Original', 'Canonical name must NOT be overwritten by duplicate import');
    });

    it('rejects invalid Brazilian phone numbers with InvalidPhoneNumberError', () => {
      assert.throws(
        () => {
          contactService.findOrCreateContact(ctx.organizationId, {
            phone: '11111111111', // Dummy repeated digits
            name: 'Invalido',
          });
        },
        (err) => err instanceof InvalidPhoneNumberError
      );

      assert.throws(
        () => {
          contactService.findOrCreateContact(ctx.organizationId, {
            phone: '00', // Too short
            name: 'Curto',
          });
        },
        (err) => err instanceof InvalidPhoneNumberError
      );
    });

    it('deliberately edits canonical profile and attributes member audit (ADR 0041)', () => {
      const { contact } = contactService.findOrCreateContact(ctx.organizationId, {
        phone: '11999998888',
        name: 'João',
      });

      const updated = contactService.updateCanonicalProfile(contact.id, ctx.memberId, {
        name: 'João Deliberado',
        notes: 'Cliente VIP editado pelo operador',
        customFields: { segmento: 'Enterprise' },
      });

      assert.equal(updated.name, 'João Deliberado');
      assert.equal(updated.canonicalProfile.notes, 'Cliente VIP editado pelo operador');
      assert.equal(updated.canonicalProfile.customFields['segmento'], 'Enterprise');
      assert.equal(updated.canonicalProfile.lastEditedByMemberId, ctx.memberId);
      assert.ok(updated.canonicalProfile.lastEditedAt);
    });
  });

  describe('BaseService & BaseMembership (ADR 0036 & ADR 0041)', () => {
    it('requires declared provenance and purpose to create a Base (ADR 0036)', () => {
      const base = baseService.createBase({
        organizationId: ctx.organizationId,
        name: 'Clientes Inbound 2026',
        provenance: 'Formulário do site institucional',
        purpose: 'Comunicação sobre novas atualizações da plataforma',
        acquiredAt: new Date('2026-08-15T10:00:00Z'),
      });

      assert.ok(base.id);
      assert.equal(base.name, 'Clientes Inbound 2026');
      assert.equal(base.provenance, 'Formulário do site institucional');
      assert.equal(base.purpose, 'Comunicação sobre novas atualizações da plataforma');
      assert.equal(base.acquiredAt.toISOString(), '2026-08-15T10:00:00.000Z');
    });

    it('rejects base creation with missing provenance or purpose', () => {
      assert.throws(
        () => {
          baseService.createBase({
            organizationId: ctx.organizationId,
            name: 'Base Sem Procedencia',
            provenance: '   ',
            purpose: 'Finalidade valida',
          });
        },
        (err) => err instanceof InvariantViolationError
      );

      assert.throws(
        () => {
          baseService.createBase({
            organizationId: ctx.organizationId,
            name: 'Base Sem Finalidade',
            provenance: 'Procedencia valida',
            purpose: '',
          });
        },
        (err) => err instanceof InvariantViolationError
      );
    });

    it('stores source-specific fields in base_memberships without modifying canonical contact attributes (ADR 0041)', () => {
      // 1. Create canonical contact
      const { contact } = contactService.findOrCreateContact(ctx.organizationId, {
        phone: '11977776666',
        name: 'Ana Canonical',
      });

      // 2. Create Base
      const base = baseService.createBase({
        organizationId: ctx.organizationId,
        name: 'Planilha Leads Q3',
        provenance: 'Upload CSV da equipe comercial',
        purpose: 'Follow-up de demonstração',
      });

      // 3. Add membership with source-specific imported fields
      const membership = baseService.addMembership(base.id, contact.id, {
        cargo: 'Diretora de TI',
        empresa: 'TechCorp',
        cidade: 'São Paulo',
      });

      assert.equal(membership.baseId, base.id);
      assert.equal(membership.contactId, contact.id);
      assert.equal(membership.importedFields['cargo'], 'Diretora de TI');
      assert.equal(membership.importedFields['empresa'], 'TechCorp');

      // Verify canonical contact profile remains untouched
      const canonicalContact = contactService.findById(contact.id)!;
      assert.equal(canonicalContact.name, 'Ana Canonical');
      assert.equal(canonicalContact.canonicalProfile.customFields['cargo'], undefined);

      // Verify joined memberships list
      const members = baseService.listMemberships(base.id);
      assert.equal(members.length, 1);
      assert.equal(members[0]!.contact.name, 'Ana Canonical');
      assert.equal(members[0]!.importedFields['cargo'], 'Diretora de TI');
    });
  });
});
