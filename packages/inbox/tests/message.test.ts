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

describe('Inbox: Message Service, Pagination & Search (ADR 0039 & 0042)', () => {
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

  it('stores inbound message, increments unread count and updates last_message_at', async () => {
    const result = await msgService.receiveInboundMessage({
      organizationId: ctx.organizationId,
      connectionId: ctx.connection1Id,
      senderIdentifier: '5511988881111@s.whatsapp.net',
      content: 'Gostaria de saber o valor do plano',
      externalId: 'ext_wa_msg_1001',
    });

    assert.equal(result.message.content, 'Gostaria de saber o valor do plano');
    assert.equal(result.message.direction, 'inbound');
    assert.equal(result.message.type, 'manual');
    assert.equal(result.message.kind, 'inbound');
    assert.equal(result.message.status, 'delivered');
    assert.equal(result.message.externalId, 'ext_wa_msg_1001');

    // Conversation should reflect unread_count = 1
    const conv = convService.getConversation(result.conversation.id);
    assert.equal(conv?.unreadCount, 1);
    assert.ok(conv?.lastMessageAt);
  });

  it('tracks delivery status transitions: pending -> sent -> delivered -> read', () => {
    const conv = convService.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact1Id);

    const msg = msgRepo.create({
      id: 'msg_track_1',
      conversationId: conv.id,
      direction: 'outbound',
      type: 'manual',
      content: 'Proposta enviada em anexo',
      status: 'pending',
    });
    assert.equal(msg.status, 'pending');

    // Transition to sent
    const sent = msgService.updateDeliveryStatus(msg.id, 'sent', new Date('2026-09-03T12:00:00Z'));
    assert.equal(sent.status, 'sent');
    assert.ok(sent.sentAt);

    // Transition to delivered
    const delivered = msgService.updateDeliveryStatus(msg.id, 'delivered', new Date('2026-09-03T12:00:05Z'));
    assert.equal(delivered.status, 'delivered');
    assert.ok(delivered.deliveredAt);

    // Transition to read
    const read = msgService.updateDeliveryStatus(msg.id, 'read', new Date('2026-09-03T12:01:00Z'));
    assert.equal(read.status, 'read');
    assert.ok(read.readAt);
  });

  it('supports message pagination with offset and cursor', () => {
    const conv = convService.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact1Id);

    // Seed 15 messages with distinct timestamps
    for (let i = 1; i <= 15; i++) {
      const time = new Date(Date.parse('2026-09-03T10:00:00Z') + i * 60000);
      msgRepo.create({
        id: `msg_page_${String(i).padStart(2, '0')}`,
        conversationId: conv.id,
        direction: i % 2 === 0 ? 'outbound' : 'inbound',
        type: 'manual',
        content: `Mensagem número ${i}`,
        createdAt: time,
        sentAt: time,
      });
    }

    // 1. Offset-based pagination
    const page1 = msgService.listMessages(conv.id, { limit: 5, offset: 0 });
    assert.equal(page1.items.length, 5);
    assert.equal(page1.total, 15);
    assert.equal(page1.items[0]?.content, 'Mensagem número 1');
    assert.equal(page1.items[4]?.content, 'Mensagem número 5');

    const page2 = msgService.listMessages(conv.id, { limit: 5, offset: 5 });
    assert.equal(page2.items.length, 5);
    assert.equal(page2.items[0]?.content, 'Mensagem número 6');
    assert.equal(page2.items[4]?.content, 'Mensagem número 10');

    // 2. Cursor-based pagination
    const cursorPage1 = msgService.listMessages(conv.id, { limit: 5 });
    assert.equal(cursorPage1.items.length, 5);
    assert.ok(cursorPage1.nextCursor);

    const cursorPage2 = msgService.listMessages(conv.id, {
      limit: 5,
      cursor: cursorPage1.nextCursor,
    });
    assert.equal(cursorPage2.items.length, 5);
    assert.equal(cursorPage2.items[0]?.content, 'Mensagem número 6');
    assert.ok(cursorPage2.nextCursor);

    const cursorPage3 = msgService.listMessages(conv.id, {
      limit: 5,
      cursor: cursorPage2.nextCursor,
    });
    assert.equal(cursorPage3.items.length, 5);
    assert.equal(cursorPage3.items[0]?.content, 'Mensagem número 11');
    assert.equal(cursorPage3.nextCursor, undefined);
  });

  it('searches messages within database across conversations and with filters', () => {
    const conv1 = convService.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact1Id);
    const conv2 = convService.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact2Id);

    msgRepo.create({
      id: 'msg_s1',
      conversationId: conv1.id,
      direction: 'inbound',
      type: 'manual',
      content: 'Qual o valor do orçamento comercial?',
    });
    msgRepo.create({
      id: 'msg_s2',
      conversationId: conv1.id,
      direction: 'outbound',
      type: 'manual',
      content: 'O orçamento foi enviado por email.',
    });
    msgRepo.create({
      id: 'msg_s3',
      conversationId: conv2.id,
      direction: 'inbound',
      type: 'manual',
      content: 'Preciso de um novo orçamento para 5 usuários.',
    });
    msgRepo.create({
      id: 'msg_s4',
      conversationId: conv2.id,
      direction: 'inbound',
      type: 'manual',
      content: 'Não tenho dúvidas no momento.',
    });

    // Global search in organization
    const searchAll = msgService.searchMessages({
      organizationId: ctx.organizationId,
      query: 'orçamento',
    });
    assert.equal(searchAll.total, 3);
    assert.equal(searchAll.items.length, 3);

    // Filtered by specific conversation
    const searchConv1 = msgService.searchMessages({
      organizationId: ctx.organizationId,
      conversationId: conv1.id,
      query: 'orçamento',
    });
    assert.equal(searchConv1.total, 2);

    // Filtered by contact2
    const searchContact2 = msgService.searchMessages({
      organizationId: ctx.organizationId,
      contactId: ctx.contact2Id,
      query: 'orçamento',
    });
    assert.equal(searchContact2.total, 1);
    assert.equal(searchContact2.items[0]?.content, 'Preciso de um novo orçamento para 5 usuários.');
  });

  it('evaluates ADR 0042 response attribution to the most recent automated campaign job', async () => {
    const conv = convService.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact1Id);
    const now = new Date().toISOString();

    // Insert campaign and job to satisfy SQLite foreign keys
    ctx.conn.prepare(`
      INSERT INTO campaigns (
        id, organization_id, connection_id, name, status,
        message_template, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'running', 'Template', ?, ?)
    `).run('camp_01', ctx.organizationId, ctx.connection1Id, 'Campanha Teste', now, now);

    ctx.conn.prepare(`
      INSERT INTO campaign_jobs (
        id, campaign_id, contact_id, normalized_phone,
        rendered_message, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'sent', ?, ?)
    `).run('job_camp_01', 'camp_01', ctx.contact1Id, '5511988881111', 'Campanha Black Friday: 20% off!', now, now);

    // First, insert an outbound automated campaign message
    msgRepo.create({
      id: 'msg_auto_1',
      conversationId: conv.id,
      direction: 'outbound',
      type: 'automated',
      kind: 'automated',
      content: 'Campanha Black Friday: 20% off!',
      campaignJobId: 'job_camp_01',
      status: 'delivered',
      createdAt: new Date('2026-09-03T09:00:00Z'),
    });

    // Ana responds to the message
    const inbound = await msgService.receiveInboundMessage({
      organizationId: ctx.organizationId,
      connectionId: ctx.connection1Id,
      senderIdentifier: '5511988881111',
      content: 'Quero aproveitar o desconto!',
    });

    assert.ok(inbound.attribution);
    assert.equal(inbound.attribution.campaignJobId, 'job_camp_01');
    assert.equal(inbound.attribution.isAmbiguous, false);
  });
});
