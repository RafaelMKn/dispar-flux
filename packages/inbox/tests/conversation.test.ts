import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDatabase, type TestContext } from './test-helpers.js';
import {
  ConversationRepository,
  MessageRepository,
  ConversationService,
} from '../src/index.js';

describe('Inbox: Conversation Service & Partitioning (ADR 0039)', () => {
  let ctx: TestContext;
  let convRepo: ConversationRepository;
  let msgRepo: MessageRepository;
  let service: ConversationService;

  beforeEach(() => {
    ctx = setupTestDatabase();
    convRepo = new ConversationRepository(ctx.conn);
    msgRepo = new MessageRepository(ctx.conn);
    service = new ConversationService(convRepo, msgRepo);
  });

  afterEach(() => {
    ctx.conn.close();
  });

  it('strictly partitions conversations by (ConnectionId, ContactId) (ADR 0039)', () => {
    // Ana interacts with Connection 1 (Comercial)
    const convConn1 = service.getOrCreateConversation(
      ctx.organizationId,
      ctx.connection1Id,
      ctx.contact1Id
    );

    // Ana interacts with Connection 2 (Suporte)
    const convConn2 = service.getOrCreateConversation(
      ctx.organizationId,
      ctx.connection2Id,
      ctx.contact1Id
    );

    // Conversations MUST be distinct records
    assert.notEqual(convConn1.id, convConn2.id);
    assert.equal(convConn1.connectionId, ctx.connection1Id);
    assert.equal(convConn2.connectionId, ctx.connection2Id);
    assert.equal(convConn1.contactId, ctx.contact1Id);
    assert.equal(convConn2.contactId, ctx.contact1Id);

    // Subsequent calls to getOrCreateConversation return the exact same conversation
    const convConn1Again = service.getOrCreateConversation(
      ctx.organizationId,
      ctx.connection1Id,
      ctx.contact1Id
    );
    assert.equal(convConn1Again.id, convConn1.id);
  });

  it('maintains message isolation across different connections for the same contact', () => {
    const conv1 = service.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact1Id);
    const conv2 = service.getOrCreateConversation(ctx.organizationId, ctx.connection2Id, ctx.contact1Id);

    // Add message to conv1
    msgRepo.create({
      id: 'msg_conn1_1',
      conversationId: conv1.id,
      direction: 'inbound',
      type: 'manual',
      content: 'Olá comercial',
    });

    // Add message to conv2
    msgRepo.create({
      id: 'msg_conn2_1',
      conversationId: conv2.id,
      direction: 'inbound',
      type: 'manual',
      content: 'Preciso de suporte técnico',
    });

    // List messages for conv1
    const messages1 = msgRepo.listByConversation(conv1.id);
    assert.equal(messages1.items.length, 1);
    assert.equal(messages1.items[0]?.content, 'Olá comercial');

    // List messages for conv2
    const messages2 = msgRepo.listByConversation(conv2.id);
    assert.equal(messages2.items.length, 1);
    assert.equal(messages2.items[0]?.content, 'Preciso de suporte técnico');
  });

  it('aggregates conversations chronologically for a contact while preserving connection binding (ADR 0039)', () => {
    const conv1 = service.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact1Id);
    const conv2 = service.getOrCreateConversation(ctx.organizationId, ctx.connection2Id, ctx.contact1Id);

    service.touchLastMessage(conv1.id, new Date('2026-09-03T10:00:00Z'));
    service.touchLastMessage(conv2.id, new Date('2026-09-03T11:00:00Z'));

    const aggregated = service.getContactAggregatedConversations(ctx.organizationId, ctx.contact1Id);
    assert.equal(aggregated.length, 2);
    // Ordered by most recent last_message_at DESC
    assert.equal(aggregated[0]?.id, conv2.id);
    assert.equal(aggregated[1]?.id, conv1.id);
  });

  it('manages unread counter and synchronization', () => {
    const conv = service.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact1Id);
    assert.equal(conv.unreadCount, 0);

    service.incrementUnread(conv.id);
    service.incrementUnread(conv.id);

    const fetched = service.getConversation(conv.id);
    assert.equal(fetched?.unreadCount, 2);

    // Create 2 inbound unread messages
    msgRepo.create({
      id: 'msg_u1',
      conversationId: conv.id,
      direction: 'inbound',
      type: 'manual',
      content: 'Mensagem 1',
      status: 'delivered',
    });
    msgRepo.create({
      id: 'msg_u2',
      conversationId: conv.id,
      direction: 'inbound',
      type: 'manual',
      content: 'Mensagem 2',
      status: 'delivered',
    });

    // Mark as read
    const { conversation, readCount } = service.markAsRead(conv.id);
    assert.equal(conversation.unreadCount, 0);
    assert.equal(readCount, 2);

    // Verify messages in DB are now status 'read'
    const m1 = msgRepo.findById('msg_u1');
    const m2 = msgRepo.findById('msg_u2');
    assert.equal(m1?.status, 'read');
    assert.ok(m1?.readAt);
    assert.equal(m2?.status, 'read');
    assert.ok(m2?.readAt);
  });
});
