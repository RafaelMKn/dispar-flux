import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDatabase, type TestContext } from './test-helpers.js';
import {
  ConversationRepository,
  MessageRepository,
  LidJidRepository,
  ConversationService,
  MessageService,
} from '../src/index.js';

describe('Inbox: LID and JID Mapping Resolution (ADR 0039)', () => {
  let ctx: TestContext;
  let convRepo: ConversationRepository;
  let msgRepo: MessageRepository;
  let lidJidRepo: LidJidRepository;
  let convService: ConversationService;
  let msgService: MessageService;

  beforeEach(() => {
    ctx = setupTestDatabase();
    convRepo = new ConversationRepository(ctx.conn);
    msgRepo = new MessageRepository(ctx.conn);
    lidJidRepo = new LidJidRepository(ctx.conn);
    convService = new ConversationService(convRepo, msgRepo);
    msgService = new MessageService(ctx.conn, convService, msgRepo, lidJidRepo);
  });

  afterEach(() => {
    ctx.conn.close();
  });

  it('enforces ADR 0039: JID and LID do not create distinct business identities', async () => {
    const phoneJid = '5511988881111@s.whatsapp.net';
    const accountLid = '98765432101234@lid';

    // 1. Inbound message received via standard Phone JID
    const msg1 = await msgService.receiveInboundMessage({
      organizationId: ctx.organizationId,
      connectionId: ctx.connection1Id,
      senderIdentifier: phoneJid,
      content: 'Primeira mensagem pelo JID',
    });

    assert.equal(msg1.contactId, ctx.contact1Id);
    const initialConvId = msg1.conversation.id;

    // 2. Register mapping linking the WhatsApp LID to Ana's contact
    lidJidRepo.registerMapping({
      organizationId: ctx.organizationId,
      contactId: ctx.contact1Id,
      jid: phoneJid,
      lid: accountLid,
      normalizedPhone: '5511988881111',
    });

    // 3. Second inbound message arrives identified by WhatsApp LID
    const msg2 = await msgService.receiveInboundMessage({
      organizationId: ctx.organizationId,
      connectionId: ctx.connection1Id,
      senderIdentifier: accountLid,
      content: 'Segunda mensagem recebida pelo LID',
    });

    // Invariant: Both must resolve to the EXACT SAME Contact ID and Conversation ID
    assert.equal(msg2.contactId, ctx.contact1Id);
    assert.equal(msg2.conversation.id, initialConvId);

    // Verify conversation contains both messages
    const conversationMessages = msgRepo.listByConversation(initialConvId);
    assert.equal(conversationMessages.items.length, 2);
    assert.equal(conversationMessages.items[0]?.content, 'Primeira mensagem pelo JID');
    assert.equal(conversationMessages.items[1]?.content, 'Segunda mensagem recebida pelo LID');

    // Verify no redundant contact was created in the database
    const contactsCount = ctx.conn
      .prepare('SELECT COUNT(*) as count FROM contacts WHERE organization_id = ?')
      .get(ctx.organizationId) as { count: number };
    assert.equal(contactsCount.count, 2, 'Must maintain exactly the 2 seeded contacts');
  });

  it('resolves raw international phone numbers and links them properly', () => {
    const rawNumber = '+55 (11) 98888-2222';
    const resolved = lidJidRepo.resolveIdentifier(ctx.organizationId, rawNumber);

    assert.ok(resolved);
    assert.equal(resolved.contactId, ctx.contact2Id);
    assert.equal(resolved.normalizedPhone, '5511988882222');
  });
});
