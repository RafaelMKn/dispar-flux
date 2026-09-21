import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDatabase, type TestContext } from './test-helpers.js';
import {
  CopilotService,
  ConversationService,
  ConversationRepository,
  MessageRepository,
  LidJidRepository,
  type AiCaller,
} from '../src/index.js';

describe('Inbox Copilot Service: AI Drafting & Summary (Block A)', () => {
  let ctx: TestContext;
  let convRepo: ConversationRepository;
  let msgRepo: MessageRepository;
  let lidJidRepo: LidJidRepository;
  let convService: ConversationService;
  let copilotService: CopilotService;

  beforeEach(() => {
    ctx = setupTestDatabase();
    convRepo = new ConversationRepository(ctx.conn);
    msgRepo = new MessageRepository(ctx.conn);
    lidJidRepo = new LidJidRepository(ctx.conn);
    convService = new ConversationService(convRepo, msgRepo);
    copilotService = new CopilotService(ctx.conn, {
      conversationRepo: convRepo,
      messageRepo: msgRepo,
      lidJidRepo,
    });
  });

  afterEach(() => {
    ctx.conn.close();
  });

  it('suggests replies in different tones (formal, direct, consultative) using contextual fallback', async () => {
    const chatJid = '5511988881111@s.whatsapp.net';
    const conv = convService.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact1Id);

    // Add an inbound question from contact Ana
    msgRepo.create({
      conversationId: conv.id,
      direction: 'inbound',
      type: 'manual',
      kind: 'inbound',
      content: 'Olá! Gostaria de saber os preços e planos disponíveis.',
      status: 'delivered',
      createdAt: new Date('2026-09-14T10:00:00.000Z'),
    });

    // 1. Formal tone
    const formalResult = await copilotService.suggestReply({
      organizationId: ctx.organizationId,
      chatJid,
      tone: 'formal',
    });
    assert.ok(formalResult.suggestion.includes('Prezada Ana'));
    assert.ok(formalResult.suggestion.includes('Atenciosamente'));
    assert.ok(formalResult.contextTokensUsed > 0);

    // 2. Direct tone
    const directResult = await copilotService.suggestReply({
      organizationId: ctx.organizationId,
      chatJid,
      tone: 'direct',
    });
    assert.ok(directResult.suggestion.startsWith('Olá, Ana.'));
    assert.ok(directResult.suggestion.toLowerCase().includes('valores'));
    assert.ok(!directResult.suggestion.includes('Atenciosamente'));

    // 3. Consultative tone (default)
    const consultativeResult = await copilotService.suggestReply({
      organizationId: ctx.organizationId,
      chatJid,
      tone: 'consultative',
    });
    assert.ok(consultativeResult.suggestion.includes('Olá, Ana! Tudo bem com você?'));
    assert.ok(consultativeResult.suggestion.includes('Qualquer dúvida, é só me chamar!'));
  });

  it('incorporates operator custom instructions into the suggested reply', async () => {
    const chatJid = '5511988881111@s.whatsapp.net';
    convService.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact1Id);

    const result = await copilotService.suggestReply({
      organizationId: ctx.organizationId,
      chatJid,
      tone: 'consultative',
      instruction: 'Avisar que temos desconto especial de 15% válido até sexta-feira',
    });

    assert.ok(result.suggestion.includes('15%'));
    assert.ok(result.suggestion.includes('sexta-feira'));
    assert.ok(result.suggestion.includes('Ana'));
  });

  it('selects the last 10 messages ordered chronologically', async () => {
    const chatJid = '5511988881111@s.whatsapp.net';
    const conv = convService.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact1Id);

    // Create 15 messages with increasing timestamps
    for (let i = 1; i <= 15; i++) {
      const isEven = i % 2 === 0;
      msgRepo.create({
        conversationId: conv.id,
        direction: isEven ? 'outbound' : 'inbound',
        type: 'manual',
        kind: isEven ? 'manual' : 'inbound',
        content: `Mensagem número ${i}`,
        status: 'delivered',
        createdAt: new Date(Date.now() + i * 1000),
      });
    }

    let capturedPrompt = '';
    const mockCaller: AiCaller = async ({ userPrompt }) => {
      capturedPrompt = userPrompt;
      return 'Resposta gerada por IA com sucesso.';
    };

    // Configure mock AI
    ctx.conn.prepare(`
      INSERT INTO ai_configs (id, organization_id, provider, api_key_ciphertext, model_name, system_instructions, operational_rules_json, created_at, updated_at)
      VALUES ('ai_cfg_1', ?, 'openai', 'sk-fake-test-key', 'gpt-4o-mini', 'System rule', '{}', datetime('now'), datetime('now'))
    `).run(ctx.organizationId);

    const customCopilot = new CopilotService(ctx.conn, {
      conversationRepo: convRepo,
      messageRepo: msgRepo,
      lidJidRepo,
      aiCaller: mockCaller,
    });

    const res = await customCopilot.suggestReply({
      organizationId: ctx.organizationId,
      chatJid,
      tone: 'consultative',
    });

    assert.equal(res.suggestion, 'Resposta gerada por IA com sucesso.');
    // Must NOT contain messages 1 to 5 (since only last 10 messages 6..15 should be included)
    assert.ok(!capturedPrompt.includes('Mensagem número 1\n'));
    assert.ok(!capturedPrompt.includes('Mensagem número 5\n'));
    // Must contain messages 6 to 15
    assert.ok(capturedPrompt.includes('Mensagem número 6'));
    assert.ok(capturedPrompt.includes('Mensagem número 15'));
    // Verify chronological order: message 6 appears before message 15
    const idx6 = capturedPrompt.indexOf('Mensagem número 6');
    const idx15 = capturedPrompt.indexOf('Mensagem número 15');
    assert.ok(idx6 < idx15, 'Messages in prompt must be in chronological ASC order');
  });

  it('summarizes a conversation with keyPoints and nextSteps', async () => {
    const chatJid = '5511988881111@s.whatsapp.net';
    const conv = convService.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact1Id);

    msgRepo.create({
      conversationId: conv.id,
      direction: 'inbound',
      type: 'manual',
      kind: 'inbound',
      content: 'Gostaria de agendar uma demonstração do sistema para amanhã.',
      status: 'delivered',
      createdAt: new Date('2026-09-14T09:00:00.000Z'),
    });

    msgRepo.create({
      conversationId: conv.id,
      direction: 'outbound',
      type: 'manual',
      kind: 'manual',
      content: 'Perfeito Ana! Temos horário às 14h ou às 16h.',
      status: 'delivered',
      createdAt: new Date('2026-09-14T09:05:00.000Z'),
    });

    const summaryRes = await copilotService.summarizeConversation({
      organizationId: ctx.organizationId,
      chatJid,
      saveAsLeadNote: false,
    });

    assert.ok(summaryRes.summary.length > 0);
    assert.ok(summaryRes.summary.includes('Ana'));
    assert.ok(Array.isArray(summaryRes.keyPoints) && summaryRes.keyPoints.length > 0);
    assert.ok(Array.isArray(summaryRes.nextSteps) && summaryRes.nextSteps.length > 0);
  });

  it('saves conversation summary to CRM lead notes when saveAsLeadNote is true', async () => {
    const chatJid = '5511988881111@s.whatsapp.net';
    const conv = convService.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact1Id);

    msgRepo.create({
      conversationId: conv.id,
      direction: 'inbound',
      type: 'manual',
      kind: 'inbound',
      content: 'Preciso de uma proposta urgente para 50 atendentes.',
      status: 'delivered',
      createdAt: new Date('2026-09-14T09:00:00.000Z'),
    });

    // Create a Funnel and a Lead for contact1
    const funnelId = 'fn_vendas_1';
    ctx.conn.prepare(`
      INSERT INTO funnels (id, organization_id, name, stages, created_at, updated_at)
      VALUES (?, ?, 'Funil Comercial', '[{"id":"st_1","name":"Novos"},{"id":"st_2","name":"Negociação"}]', datetime('now'), datetime('now'))
    `).run(funnelId, ctx.organizationId);

    const leadId = 'lead_ana_1';
    ctx.conn.prepare(`
      INSERT INTO leads (id, organization_id, funnel_id, contact_id, stage_id, notes, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'st_2', 'Nota inicial do operador.', datetime('now'), datetime('now'))
    `).run(leadId, ctx.organizationId, funnelId, ctx.contact1Id);

    const summaryRes = await copilotService.summarizeConversation({
      organizationId: ctx.organizationId,
      chatJid,
      saveAsLeadNote: true,
    });

    assert.ok(summaryRes.summary);

    // Query leads table to verify note concatenation
    const leadRow = ctx.conn.prepare('SELECT notes FROM leads WHERE id = ?').get(leadId) as { notes: string };
    assert.ok(leadRow.notes.includes('Nota inicial do operador.'));
    assert.ok(leadRow.notes.includes('Resumo'));
    assert.ok(leadRow.notes.includes(summaryRes.summary));
  });

  it('creates lead with summary note if contact has no prior lead but funnel exists', async () => {
    const chatJid = '5511988882222@s.whatsapp.net'; // Bruno
    const conv = convService.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact2Id);

    msgRepo.create({
      conversationId: conv.id,
      direction: 'inbound',
      type: 'manual',
      kind: 'inbound',
      content: 'Tenho interesse na plataforma.',
      status: 'delivered',
      createdAt: new Date('2026-09-14T11:00:00.000Z'),
    });

    // Create funnel only (no lead for Bruno yet)
    ctx.conn.prepare(`
      INSERT INTO funnels (id, organization_id, name, stages, created_at, updated_at)
      VALUES ('fn_auto_1', ?, 'Funil Principal', '[{"id":"st_inicio","name":"Início"}]', datetime('now'), datetime('now'))
    `).run(ctx.organizationId);

    await copilotService.summarizeConversation({
      organizationId: ctx.organizationId,
      chatJid,
      saveAsLeadNote: true,
    });

    const leadRow = ctx.conn.prepare('SELECT * FROM leads WHERE organization_id = ? AND contact_id = ?').get(ctx.organizationId, ctx.contact2Id) as any;
    assert.ok(leadRow, 'Lead should be automatically created');
    assert.equal(leadRow.stage_id, 'st_inicio');
    assert.ok(leadRow.notes.includes('Resumo'));
  });

  it('handles offline / unconfigured AI gracefully and falls back to template', async () => {
    // Zero rows in ai_configs table
    const chatJid = '5511988881111@s.whatsapp.net';
    convService.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact1Id);

    // Must not throw, must return valid result
    const suggest = await copilotService.suggestReply({
      organizationId: ctx.organizationId,
      chatJid,
    });
    assert.ok(suggest.suggestion);
    assert.ok(suggest.contextTokensUsed > 0);

    const summary = await copilotService.summarizeConversation({
      organizationId: ctx.organizationId,
      chatJid,
    });
    assert.ok(summary.summary);
    assert.ok(Array.isArray(summary.keyPoints));
    assert.ok(Array.isArray(summary.nextSteps));
  });

  it('falls back gracefully when AI caller throws network/API error', async () => {
    const chatJid = '5511988881111@s.whatsapp.net';
    convService.getOrCreateConversation(ctx.organizationId, ctx.connection1Id, ctx.contact1Id);

    ctx.conn.prepare(`
      INSERT INTO ai_configs (id, organization_id, provider, api_key_ciphertext, model_name, system_instructions, operational_rules_json, created_at, updated_at)
      VALUES ('ai_cfg_err', ?, 'gemini', 'bad-api-key', 'gemini-1.5-flash', null, '{}', datetime('now'), datetime('now'))
    `).run(ctx.organizationId);

    const failingCaller: AiCaller = async () => {
      throw new Error('Network error: connection refused / timeout');
    };

    const failingCopilot = new CopilotService(ctx.conn, {
      conversationRepo: convRepo,
      messageRepo: msgRepo,
      lidJidRepo,
      aiCaller: failingCaller,
    });

    const suggest = await failingCopilot.suggestReply({
      organizationId: ctx.organizationId,
      chatJid,
      tone: 'formal',
    });

    // Successfully fell back to heuristic template
    assert.ok(suggest.suggestion.includes('Prezada Ana'));

    const summary = await failingCopilot.summarizeConversation({
      organizationId: ctx.organizationId,
      chatJid,
    });
    assert.ok(summary.summary);
  });
});
