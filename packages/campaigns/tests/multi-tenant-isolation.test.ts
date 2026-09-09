import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ContactService } from '../src/contacts/contact-service.js';
import { BaseService } from '../src/bases/base-service.js';
import { BaseNotFoundError, ContactNotFoundError, CrossTenantViolationError } from '../src/errors.js';
import { createTestDatabase, type SeededTestContext } from './helpers/test-db.js';

describe('Multi-Tenant Data Isolation & Cross-Tenant Rejection (ADR 0034, ADR 0036, ADR 0041)', () => {
  let ctx: SeededTestContext;
  let contactService: ContactService;
  let baseService: BaseService;

  const orgA = 'org-tenant-a';
  const orgB = 'org-tenant-b';

  beforeEach(() => {
    ctx = createTestDatabase();
    contactService = new ContactService(ctx.conn);
    baseService = new BaseService(ctx.conn);

    const now = new Date().toISOString();
    // Seed Org A and Org B
    ctx.conn.prepare(`
      INSERT OR REPLACE INTO organizations (id, name, operational_timezone, created_at, updated_at)
      VALUES (?, ?, 'America/Sao_Paulo', ?, ?), (?, ?, 'America/Sao_Paulo', ?, ?)
    `).run(orgA, 'Tenant A', now, now, orgB, 'Tenant B', now, now);

    // Seed Member A and Member B
    ctx.conn.prepare(`
      INSERT OR REPLACE INTO members (id, organization_id, name, email, role, is_active, created_at, updated_at)
      VALUES (?, ?, 'Member A', 'a@tenant-a.com', 'owner', 1, ?, ?),
             (?, ?, 'Member B', 'b@tenant-b.com', 'owner', 1, ?, ?)
    `).run('mem-a', orgA, now, now, 'mem-b', orgB, now, now);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  describe('BaseService Multi-Tenant Scoping', () => {
    it('getBase: Tenant B cannot retrieve Tenant A base when scoped to orgB', () => {
      const baseA = baseService.createBase({
        organizationId: orgA,
        name: 'Lista VIP A',
        provenance: 'Formulario Web',
        purpose: 'Campanhas Promocionais',
      });

      // Tenant A can retrieve its own base
      const retrievedByA = baseService.getBase(baseA.id, orgA);
      assert.ok(retrievedByA);
      assert.equal(retrievedByA.id, baseA.id);

      // Tenant B scoped query returns null (preventing IDOR)
      const retrievedByB = baseService.getBase(baseA.id, orgB);
      assert.equal(retrievedByB, null);
    });

    it('deleteBase: Tenant B cannot delete Tenant A base when scoped to orgB', () => {
      const baseA = baseService.createBase({
        organizationId: orgA,
        name: 'Lista Protegida A',
        provenance: 'Eventos',
        purpose: 'Relacionamento',
      });

      // Tenant B tries to delete base A
      const deletedByB = baseService.deleteBase(baseA.id, orgB);
      assert.equal(deletedByB, false);

      // Base A must still exist
      const checkBase = baseService.getBase(baseA.id, orgA);
      assert.ok(checkBase);

      // Tenant A deletes its own base successfully
      const deletedByA = baseService.deleteBase(baseA.id, orgA);
      assert.equal(deletedByA, true);
      assert.equal(baseService.getBase(baseA.id, orgA), null);
    });

    it('addMembership: strictly forbids linking contact from Tenant B into Tenant A base (CrossTenantViolationError)', () => {
      const baseA = baseService.createBase({
        organizationId: orgA,
        name: 'Lista Org A',
        provenance: 'Upload CSV',
        purpose: 'Vendas',
      });

      const { contact: contactB } = contactService.findOrCreateContact(orgB, {
        phone: '11987654321',
        name: 'Contato Tenant B',
      });

      // Attempt to link Contact B into Base A
      assert.throws(
        () => baseService.addMembership(baseA.id, contactB.id, { source: 'malicious' }, orgA),
        (err: unknown) => {
          assert.ok(err instanceof CrossTenantViolationError);
          assert.ok((err as Error).message.includes('Cross-tenant membership is forbidden'));
          return true;
        }
      );

      // Base A remains empty
      assert.equal(baseService.countMemberships(baseA.id, orgA), 0);
    });

    it('addMembership: rejects when base does not belong to provided organizationId', () => {
      const baseA = baseService.createBase({
        organizationId: orgA,
        name: 'Lista Org A',
        provenance: 'Upload CSV',
        purpose: 'Vendas',
      });

      const { contact: contactB } = contactService.findOrCreateContact(orgB, {
        phone: '11987654321',
        name: 'Contato Tenant B',
      });

      // Tenant B tries to add contactB into baseA while passing orgB
      assert.throws(
        () => baseService.addMembership(baseA.id, contactB.id, {}, orgB),
        (err: unknown) => err instanceof BaseNotFoundError
      );
    });

    it('listMemberships: Tenant B cannot list memberships of Tenant A base', () => {
      const baseA = baseService.createBase({
        organizationId: orgA,
        name: 'Lista Org A',
        provenance: 'Upload CSV',
        purpose: 'Vendas',
      });

      const { contact: contactA } = contactService.findOrCreateContact(orgA, {
        phone: '11987654321',
        name: 'Contato Tenant A',
      });

      baseService.addMembership(baseA.id, contactA.id, { tag: 'vip' }, orgA);

      // Tenant A can list its own memberships
      const membersA = baseService.listMemberships(baseA.id, orgA);
      assert.equal(membersA.length, 1);
      assert.equal(membersA[0]!.contactId, contactA.id);

      // Tenant B cannot list memberships (throws BaseNotFoundError)
      assert.throws(
        () => baseService.listMemberships(baseA.id, orgB),
        (err: unknown) => err instanceof BaseNotFoundError
      );
    });
  });

  describe('ContactService Multi-Tenant Scoping', () => {
    it('findById: Tenant B cannot view Tenant A contact when scoped to orgB', () => {
      const { contact: contactA } = contactService.findOrCreateContact(orgA, {
        phone: '11911112222',
        name: 'Cliente Org A',
      });

      const foundByA = contactService.findById(contactA.id, orgA);
      assert.ok(foundByA);
      assert.equal(foundByA.id, contactA.id);

      const foundByB = contactService.findById(contactA.id, orgB);
      assert.equal(foundByB, null);
    });

    it('findByPhone: supports identical phone numbers across different tenants without collision or leakage', () => {
      const sharedPhone = '11999998888';

      // Tenant A creates contact with shared phone
      const { contact: contactA } = contactService.findOrCreateContact(orgA, {
        phone: sharedPhone,
        name: 'Rafael Org A',
      });

      // Tenant B creates contact with the SAME phone number
      const { contact: contactB } = contactService.findOrCreateContact(orgB, {
        phone: sharedPhone,
        name: 'Carlos Org B',
      });

      // They must be two distinct contacts scoped to their respective organizations
      assert.notEqual(contactA.id, contactB.id);
      assert.equal(contactA.organizationId, orgA);
      assert.equal(contactB.organizationId, orgB);

      // findByPhone strictly resolves only within the queried organization
      const queryA = contactService.findByPhone(orgA, sharedPhone);
      assert.ok(queryA);
      assert.equal(queryA.id, contactA.id);
      assert.equal(queryA.name, 'Rafael Org A');

      const queryB = contactService.findByPhone(orgB, sharedPhone);
      assert.ok(queryB);
      assert.equal(queryB.id, contactB.id);
      assert.equal(queryB.name, 'Carlos Org B');
    });

    it('updateCanonicalProfile: Tenant B cannot update Tenant A contact', () => {
      const { contact: contactA } = contactService.findOrCreateContact(orgA, {
        phone: '11933334444',
        name: 'Nome Original A',
      });

      // Member from Tenant B attempts to update contact from Tenant A
      assert.throws(
        () =>
          contactService.updateCanonicalProfile(
            contactA.id,
            'mem-b',
            { name: 'Nome Invadido B' },
            orgB
          ),
        (err: unknown) => err instanceof ContactNotFoundError
      );

      // Verify contact A was not modified
      const unchanged = contactService.findById(contactA.id, orgA);
      assert.equal(unchanged?.name, 'Nome Original A');
    });
  });
});
