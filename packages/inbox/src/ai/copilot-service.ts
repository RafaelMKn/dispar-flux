import type { DatabaseConnection } from '@dispar-flux/database';
import { normalizePhoneNumber } from '@dispar-flux/domain';
import { LidJidRepository } from '../repositories/lid-jid-repository.js';
import { ConversationRepository } from '../repositories/conversation-repository.js';
import { MessageRepository } from '../repositories/message-repository.js';

export type CopilotTone = 'formal' | 'consultative' | 'direct';
export type AiProviderType = 'gemini' | 'openai' | 'groq' | 'ollama';

export interface SuggestReplyParams {
  organizationId: string;
  chatJid: string;
  tone?: CopilotTone;
  instruction?: string;
}

export interface SuggestReplyResult {
  suggestion: string;
  contextTokensUsed: number;
}

export interface SummarizeConversationParams {
  organizationId: string;
  chatJid: string;
  saveAsLeadNote?: boolean;
}

export interface SummarizeConversationResult {
  summary: string;
  keyPoints: string[];
  nextSteps: string[];
}

export type AiCaller = (params: {
  provider: AiProviderType;
  model: string;
  apiKey: string | null;
  systemPrompt: string;
  userPrompt: string;
}) => Promise<string>;

export interface CopilotServiceOptions {
  conversationRepo?: ConversationRepository;
  messageRepo?: MessageRepository;
  lidJidRepo?: LidJidRepository;
  aiCaller?: AiCaller;
}

interface ResolvedContactContext {
  id: string | null;
  name: string;
  normalizedPhone: string;
  customFields: Record<string, unknown>;
}

interface ResolvedLeadContext {
  id: string;
  funnelId: string;
  funnelName?: string;
  stageId: string;
  stageName?: string;
  value?: number | null;
  notes?: string | null;
}

interface MessageHistoryItem {
  id: string;
  direction: 'inbound' | 'outbound';
  type: string;
  kind: string;
  content: string;
  createdAt: Date;
}

interface ResolvedAiConfig {
  provider: AiProviderType;
  model: string;
  apiKey: string | null;
  systemInstructions?: string | null;
  operationalRules: Record<string, unknown>;
}

/**
 * Default network caller for supported AI providers:
 * - OpenAI (gpt-4o, gpt-4o-mini, etc.)
 * - Groq (llama-3.3, mixtral, etc.)
 * - Google Gemini (gemini-1.5-flash, gemini-2.0-flash, etc.)
 * - Ollama (local model execution)
 */
export async function defaultAiCaller(params: {
  provider: AiProviderType;
  model: string;
  apiKey: string | null;
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const { provider, model, apiKey, systemPrompt, userPrompt } = params;

  if (provider === 'openai') {
    if (!apiKey) throw new Error('OpenAI API key is required');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI error (${res.status}): ${errText}`);
    }
    const data = (await res.json()) as any;
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  if (provider === 'groq') {
    if (!apiKey) throw new Error('Groq API key is required');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Groq error (${res.status}): ${errText}`);
    }
    const data = (await res.json()) as any;
    return data.choices?.[0]?.message?.content?.trim() || '';
  }

  if (provider === 'gemini') {
    if (!apiKey) throw new Error('Gemini API key is required');
    const modelName = model || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }],
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini error (${res.status}): ${errText}`);
    }
    const data = (await res.json()) as any;
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  }

  if (provider === 'ollama') {
    const host = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
    const res = await fetch(`${host}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: model || 'llama3',
        prompt: userPrompt,
        system: systemPrompt,
        stream: false,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama error (${res.status}): ${errText}`);
    }
    const data = (await res.json()) as any;
    return data.response?.trim() || '';
  }

  throw new Error(`Unsupported AI provider: ${provider}`);
}

function extractFirstName(fullName?: string): string {
  if (!fullName) return '';
  const trimmed = fullName.trim();
  if (!trimmed || /^\+?\d+$/.test(trimmed)) return '';
  const parts = trimmed.split(/\s+/);
  return parts[0] || '';
}

function formatSentence(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  return trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
}

function getFormalSalutation(firstName?: string): string {
  if (!firstName) return 'Prezado(a) cliente, como vai?';
  const lower = firstName.toLowerCase();
  if (lower.endsWith('a')) {
    return `Prezada ${firstName}, como vai?`;
  }
  if (lower.endsWith('o')) {
    return `Prezado ${firstName}, como vai?`;
  }
  return `Prezado(a) ${firstName}, como vai?`;
}

/**
 * Robust, offline-capable contextual template generator for drafting operator replies.
 */
function generateFallbackSuggestion(params: {
  contactName: string;
  tone: CopilotTone;
  instruction?: string;
  lastMessage?: string;
  leadStageName?: string;
  leadNotes?: string;
}): string {
  const firstName = extractFirstName(params.contactName);
  const tone = params.tone;
  const instruction = params.instruction?.trim();
  const lastMsg = params.lastMessage?.toLowerCase().trim() || '';

  // 1. Explicit operator instruction takes precedence
  if (instruction) {
    if (tone === 'formal') {
      const salutation = getFormalSalutation(firstName);
      return `${salutation}\n\nEm atenção ao seu contato, gostaríamos de informar que ${formatSentence(instruction)}. Permanecemos à disposição para quaisquer esclarecimentos adicionais.\n\nAtenciosamente,\nEquipe de Atendimento`;
    }
    if (tone === 'direct') {
      const salutation = firstName ? `Olá, ${firstName}.` : 'Olá.';
      return `${salutation} Sobre sua solicitação: ${instruction}. Fico no aguardo do seu retorno.`;
    }
    // consultative
    const salutation = firstName ? `Olá, ${firstName}! Tudo bem com você?` : 'Olá! Tudo bem com você?';
    return `${salutation}\n\nPassando para te posicionar: ${instruction}. Como fica melhor para você? Qualquer dúvida, estou por aqui!`;
  }

  // 2. Contextual analysis of the last inbound message
  const isPricing = /(pre[çc]o|valor|quanto custa|or[çc]amento|tabela|plano)/i.test(lastMsg);
  const isScheduling = /(reuni[aã]o|reuni[oõ]es|agenda|agendar|hor[aá]rio|marcar|conversar)/i.test(lastMsg);
  const isDoubt = /(d[uú]vida|como funciona|n[aã]o entendi|explica|ajuda|\?)/i.test(lastMsg);
  const isGreeting = /(ol[aá]|oi|bom dia|boa tarde|boa noite|opa)/i.test(lastMsg);

  if (tone === 'formal') {
    const salutation = getFormalSalutation(firstName);
    if (isPricing) {
      return `${salutation}\n\nEm relação à sua consulta sobre nossos valores e condições comerciais, teremos satisfação em apresentar uma proposta personalizada para atender suas necessidades. Podemos lhe encaminhar o descritivo completo agora?\n\nAtenciosamente,\nEquipe de Atendimento`;
    }
    if (isScheduling) {
      return `${salutation}\n\nSerá uma honra agendarmos um horário de atendimento. Qual dia e período de sua preferência para alinharmos os detalhes?\n\nAtenciosamente,\nEquipe de Atendimento`;
    }
    if (isDoubt) {
      return `${salutation}\n\nRecebemos suas dúvidas e estamos plenamente à disposição para prestar todos os esclarecimentos necessários. Podemos detalhar as informações para você agora?\n\nAtenciosamente,\nEquipe de Atendimento`;
    }
    if (isGreeting) {
      return `${salutation}\n\nAgradecemos o seu contato com nossa equipe. Em que podemos ser úteis no dia de hoje?\n\nAtenciosamente,\nEquipe de Atendimento`;
    }
    return `${salutation}\n\nConfirmamos o recebimento de sua mensagem e estamos prontos para dar continuidade ao seu atendimento.\n\nAtenciosamente,\nEquipe de Atendimento`;
  }

  if (tone === 'direct') {
    const salutation = firstName ? `Olá, ${firstName}.` : 'Olá.';
    if (isPricing) {
      return `${salutation} Nossos valores dependem do plano escolhido. Posso te enviar a tabela completa agora?`;
    }
    if (isScheduling) {
      return `${salutation} Podemos agendar sim. Qual melhor dia e horário para você?`;
    }
    if (isDoubt) {
      return `${salutation} Sobre sua dúvida, posso te explicar os detalhes agora. Vamos em frente?`;
    }
    if (isGreeting) {
      return `${salutation} Como posso te ajudar hoje?`;
    }
    return `${salutation} Mensagem recebida. Vamos dar andamento no seu atendimento por aqui.`;
  }

  // consultative (default)
  const salutation = firstName ? `Olá, ${firstName}! Tudo bem com você?` : 'Olá! Tudo bem com você?';
  if (isPricing) {
    return `${salutation}\n\nQue ótimo seu interesse em nossas soluções! Temos opções flexíveis para atender exatamente o que a sua operação precisa com o melhor custo-benefício. Posso te apresentar as propostas ideais para você? Qualquer dúvida, é só me chamar!`;
  }
  if (isScheduling) {
    return `${salutation}\n\nCom certeza! Adoraria bater um papo para entendermos seu momento e como podemos te apoiar da melhor forma. Amanhã pela manhã ou à tarde fica bom para você?`;
  }
  if (isDoubt) {
    return `${salutation}\n\nExcelente ponto que você trouxe! Ficarei muito feliz em te explicar cada detalhe de como funciona. Se preferir, posso te enviar um resumo rápido ou conversamos por aqui mesmo. O que acha?`;
  }
  if (isGreeting) {
    return `${salutation}\n\nQue bom receber seu contato! Como posso ajudar você a alcançar seus objetivos hoje? Fique à vontade para me contar o que precisa.`;
  }
  return `${salutation}\n\nMuito obrigado pelo retorno! Estou acompanhando seu atendimento e à disposição para te apoiar em qualquer etapa. Qualquer dúvida, é só me chamar!`;
}

/**
 * Robust, offline-capable summarizer for conversations.
 */
function generateFallbackSummary(params: {
  contactName: string;
  phone: string;
  messages: MessageHistoryItem[];
  leadStageName?: string;
  leadNotes?: string;
}): SummarizeConversationResult {
  const count = params.messages.length;
  const inbounds = params.messages.filter((m) => m.direction === 'inbound');
  const outbounds = params.messages.filter((m) => m.direction === 'outbound');
  const lastInbound = inbounds[inbounds.length - 1];

  if (count === 0) {
    return {
      summary: `Conversa com ${params.contactName || params.phone} sem mensagens anteriores registradas no sistema.`,
      keyPoints: [
        'Canal de atendimento aberto e pronto para interação.',
        'Nenhum histórico recente localizado nesta conversa.',
      ],
      nextSteps: [
        'Enviar mensagem de boas-vindas / abordagem inicial pelo operador.',
      ],
    };
  }

  const allText = params.messages.map((m) => m.content).join(' ');
  const hasPricing = /\b(pre[çc]o|valor|or[çc]amento|quanto custa|tabela)\b/i.test(allText);
  const hasScheduling = /\b(reuni[aã]o|agenda|hor[aá]rio|marcar)\b/i.test(allText);
  const hasOptOut = /\b(pare|sair|n[aã]o me chame|remover|descadastrar)\b/i.test(allText);

  let topic = 'troca de informações gerais e atendimento comercial';
  if (hasOptOut) {
    topic = 'solicitação de interrupção de mensagens (opt-out)';
  } else if (hasScheduling) {
    topic = 'alinhamento de agenda e reuniões';
  } else if (hasPricing) {
    topic = 'discussão de valores, planos e proposta comercial';
  }

  const stageSuffix = params.leadStageName ? ` O Lead está atualmente na etapa "${params.leadStageName}".` : '';
  const summary = `Conversa ativa com ${params.contactName} (${count} mensagens trocadas: ${inbounds.length} recebidas e ${outbounds.length} enviadas), focada em ${topic}.${stageSuffix}`;

  const keyPoints: string[] = [
    `Volume de mensagens: ${inbounds.length} recebidas do cliente, ${outbounds.length} enviadas pela equipe.`,
  ];
  if (lastInbound?.content) {
    const snippet = lastInbound.content.length > 80 ? `${lastInbound.content.slice(0, 80)}...` : lastInbound.content;
    keyPoints.push(`Última manifestação do contato: "${snippet}"`);
  }
  if (params.leadStageName) {
    keyPoints.push(`Status no CRM: Etapa "${params.leadStageName}"`);
  }
  if (params.leadNotes) {
    keyPoints.push(`Histórico prévio no Lead: ${params.leadNotes.split('\n')[0]}`);
  }

  const nextSteps: string[] = [];
  if (hasOptOut) {
    nextSteps.push('Confirmar bloqueio de envios automatizados e registrar supressão.');
  } else if (hasScheduling) {
    nextSteps.push('Confirmar dia e horário de reunião com o contato na Inbox.');
    nextSteps.push('Registrar compromisso na agenda do operador.');
  } else if (hasPricing) {
    nextSteps.push('Enviar proposta formal ou tabela de preços solicitada.');
    nextSteps.push('Acompanhar retorno do contato em até 24 horas.');
  } else {
    nextSteps.push('Dar continuidade ao atendimento na Inbox conforme demanda do contato.');
    nextSteps.push('Atualizar notas e etapa do Lead no funil conforme avanço da negociação.');
  }

  return { summary, keyPoints, nextSteps };
}

/**
 * Service orchestrating AI-driven assistance for inbox operators:
 * - Drafting contextual replies (AI Drafting)
 * - Summarizing conversations & syncing with CRM leads
 * Fully supports offline fallback and multiple providers (Gemini, OpenAI, Groq, Ollama).
 */
export class CopilotService {
  private readonly conn: DatabaseConnection;
  private readonly conversationRepo: ConversationRepository;
  private readonly messageRepo: MessageRepository;
  private readonly lidJidRepo: LidJidRepository;
  private readonly aiCaller: AiCaller;

  constructor(conn: DatabaseConnection, options: CopilotServiceOptions = {}) {
    this.conn = conn;
    this.conversationRepo = options.conversationRepo || new ConversationRepository(conn);
    this.messageRepo = options.messageRepo || new MessageRepository(conn);
    this.lidJidRepo = options.lidJidRepo || new LidJidRepository(conn);
    this.aiCaller = options.aiCaller || defaultAiCaller;
  }

  private resolveContactContext(organizationId: string, chatJid: string): ResolvedContactContext {
    // 1. Check lid_jid_mappings
    const resolved = this.lidJidRepo.resolveIdentifier(organizationId, chatJid);
    if (resolved && resolved.contactId) {
      const contactRow = this.conn.prepare(`
        SELECT id, name, normalized_phone, custom_fields
        FROM contacts
        WHERE organization_id = ? AND id = ?
      `).get(organizationId, resolved.contactId) as any;

      if (contactRow) {
        let customFields: Record<string, unknown> = {};
        try {
          customFields = JSON.parse(contactRow.custom_fields || '{}');
        } catch {}

        return {
          id: contactRow.id,
          name: contactRow.name || resolved.normalizedPhone || 'Cliente',
          normalizedPhone: contactRow.normalized_phone || resolved.normalizedPhone,
          customFields,
        };
      }
    }

    // 2. Direct query by phone variants
    const rawClean = chatJid.replace(/@(s\.whatsapp\.net|c\.us|lid)$/, '').trim();
    const digits = rawClean.replace(/\D/g, '');
    const withPlus = digits ? `+${digits}` : rawClean;
    const withoutPlus = digits;

    const row = this.conn.prepare(`
      SELECT id, name, normalized_phone, custom_fields
      FROM contacts
      WHERE organization_id = ?
        AND (normalized_phone = ? OR normalized_phone = ? OR normalized_phone = ? OR id = ?)
      LIMIT 1
    `).get(organizationId, rawClean, withPlus, withoutPlus, chatJid) as any;

    if (row) {
      let customFields: Record<string, unknown> = {};
      try {
        customFields = JSON.parse(row.custom_fields || '{}');
      } catch {}

      return {
        id: row.id,
        name: row.name || row.normalized_phone || 'Cliente',
        normalizedPhone: row.normalized_phone,
        customFields,
      };
    }

    // 3. Fallback synthetic contact
    return {
      id: null,
      name: rawClean ? (rawClean.startsWith('+') ? rawClean : `+${rawClean}`) : 'Cliente',
      normalizedPhone: withoutPlus,
      customFields: {},
    };
  }

  private findConversation(organizationId: string, contactId: string | null): { id: string } | null {
    if (!contactId) return null;
    const row = this.conn.prepare(`
      SELECT id FROM conversations
      WHERE organization_id = ? AND contact_id = ?
      ORDER BY COALESCE(last_message_at, created_at) DESC
      LIMIT 1
    `).get(organizationId, contactId) as { id: string } | undefined;

    return row || null;
  }

  private fetchRecentMessages(conversationId: string | null, limit: number = 10): MessageHistoryItem[] {
    if (!conversationId) return [];
    const rows = this.conn.prepare(`
      SELECT id, conversation_id, direction, type, kind, content, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(conversationId, limit) as any[];

    // Invert DESC to chronological ASC order
    const reversed = rows.slice().reverse();
    return reversed.map((r) => ({
      id: r.id,
      direction: r.direction as 'inbound' | 'outbound',
      type: r.type,
      kind: r.kind,
      content: r.content || '',
      createdAt: new Date(r.created_at),
    }));
  }

  private findLead(organizationId: string, contactId: string | null): ResolvedLeadContext | null {
    if (!contactId) return null;
    const row = this.conn.prepare(`
      SELECT l.id, l.funnel_id, l.stage_id, l.value, l.notes,
             f.name as funnel_name, f.stages as funnel_stages
      FROM leads l
      LEFT JOIN funnels f ON f.id = l.funnel_id
      WHERE l.organization_id = ? AND l.contact_id = ?
      ORDER BY l.created_at DESC
      LIMIT 1
    `).get(organizationId, contactId) as any;

    if (!row) return null;

    let stageName = row.stage_id;
    if (row.funnel_stages) {
      try {
        const stages = JSON.parse(row.funnel_stages);
        if (Array.isArray(stages)) {
          const match = stages.find((s: any) => s.id === row.stage_id);
          if (match?.name) {
            stageName = match.name;
          }
        }
      } catch {}
    }

    return {
      id: row.id,
      funnelId: row.funnel_id,
      funnelName: row.funnel_name || undefined,
      stageId: row.stage_id,
      stageName,
      value: row.value,
      notes: row.notes,
    };
  }

  private getAiConfig(organizationId: string): ResolvedAiConfig | null {
    try {
      const row = this.conn.prepare(`
        SELECT * FROM ai_configs
        WHERE organization_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `).get(organizationId) as any;

      if (!row) return null;

      let operationalRules: Record<string, unknown> = {};
      try {
        operationalRules = JSON.parse(row.operational_rules_json || '{}');
      } catch {}

      return {
        provider: row.provider as AiProviderType,
        model: row.model_name,
        apiKey: row.api_key_ciphertext || null,
        systemInstructions: row.system_instructions || null,
        operationalRules,
      };
    } catch {
      return null;
    }
  }

  /**
   * Generates a context-aware draft reply for the operator to review before sending.
   */
  async suggestReply(params: SuggestReplyParams): Promise<SuggestReplyResult> {
    const { organizationId, chatJid, instruction } = params;
    if (!organizationId) throw new Error('organizationId is required');
    if (!chatJid) throw new Error('chatJid is required');

    // 1. Resolve contact
    const contact = this.resolveContactContext(organizationId, chatJid);

    // 2. Resolve conversation & last 10 messages (chronological order)
    const conversation = this.findConversation(organizationId, contact.id);
    const messages = this.fetchRecentMessages(conversation?.id || null, 10);

    // 3. Resolve lead information
    const lead = this.findLead(organizationId, contact.id);

    // 4. Resolve AI configuration
    const aiConfig = this.getAiConfig(organizationId);

    // Resolve tone: parameter > operational rules > default
    const configuredTone = (aiConfig?.operationalRules?.tone as CopilotTone) || 'consultative';
    const tone: CopilotTone = params.tone || configuredTone;

    // Estimate context tokens
    const lastInbound = messages.slice().reverse().find((m) => m.direction === 'inbound');
    const fullContextStr = [
      aiConfig?.systemInstructions || '',
      `Tone: ${tone}`,
      `Instruction: ${instruction || ''}`,
      `Contact: ${contact.name} (${contact.normalizedPhone})`,
      lead ? `Lead: ${lead.stageName} | Notes: ${lead.notes}` : '',
      messages.map((m) => `[${m.direction}]: ${m.content}`).join('\n'),
    ].join('\n');
    const contextTokensUsed = Math.max(16, Math.ceil(fullContextStr.length / 4));

    // 5. Try calling AI provider if configured with API key (or ollama)
    const hasValidKey = aiConfig?.provider === 'ollama' || Boolean(aiConfig?.apiKey && aiConfig.apiKey.trim().length > 0);

    if (aiConfig && hasValidKey) {
      try {
        const systemPrompt = [
          aiConfig.systemInstructions || 'Você é o Copiloto de IA de atendimento via WhatsApp da empresa.',
          `Tom de voz exigido: ${tone}.`,
          tone === 'formal' ? 'Mantenha tom formal, polido e respeitoso com tratamento adequado.' :
          tone === 'direct' ? 'Seja direto, conciso e objetivo, sem enrolação ou rodeios.' :
          'Seja consultivo, empático, acolhedor e prestativo, focado em entender e resolver.',
          'Gere APENAS a mensagem para o cliente, pronta para envio pelo operador. Não use aspas nem preâmbulos.',
        ].join('\n');

        const promptParts: string[] = [];
        promptParts.push(`Contato: ${contact.name} (${contact.normalizedPhone})`);
        if (Object.keys(contact.customFields).length > 0) {
          promptParts.push(`Campos adicionais: ${JSON.stringify(contact.customFields)}`);
        }
        if (lead) {
          promptParts.push(`Lead CRM: Funil "${lead.funnelName || lead.funnelId}", Etapa "${lead.stageName || lead.stageId}"`);
          if (lead.notes) {
            promptParts.push(`Anotações anteriores: ${lead.notes}`);
          }
        }
        if (instruction) {
          promptParts.push(`Instrução do Operador: ${instruction}`);
        }
        promptParts.push('Histórico recente de mensagens (ordem cronológica):');
        if (messages.length === 0) {
          promptParts.push('(Nenhuma mensagem prévia registrada)');
        } else {
          for (const m of messages) {
            const sender = m.direction === 'inbound' ? 'Contato' : 'Operador';
            promptParts.push(`[${sender}]: ${m.content}`);
          }
        }
        promptParts.push('Gere a mensagem sugerida:');

        const aiResponse = await this.aiCaller({
          provider: aiConfig.provider,
          model: aiConfig.model,
          apiKey: aiConfig.apiKey,
          systemPrompt,
          userPrompt: promptParts.join('\n'),
        });

        if (aiResponse && aiResponse.trim().length > 0) {
          return {
            suggestion: aiResponse.trim(),
            contextTokensUsed,
          };
        }
      } catch {
        // Fallback gracefully on any network error or provider failure
      }
    }

    // 6. Fallback heuristic & contextual template generator
    const suggestion = generateFallbackSuggestion({
      contactName: contact.name,
      tone,
      instruction,
      lastMessage: lastInbound?.content,
      leadStageName: lead?.stageName,
      leadNotes: lead?.notes || undefined,
    });

    return {
      suggestion,
      contextTokensUsed,
    };
  }

  /**
   * Summarizes the conversation, produces key points and next steps,
   * with optional persistence to CRM lead notes.
   */
  async summarizeConversation(params: SummarizeConversationParams): Promise<SummarizeConversationResult> {
    const { organizationId, chatJid, saveAsLeadNote } = params;
    if (!organizationId) throw new Error('organizationId is required');
    if (!chatJid) throw new Error('chatJid is required');

    // 1. Resolve contact & conversation history
    const contact = this.resolveContactContext(organizationId, chatJid);
    const conversation = this.findConversation(organizationId, contact.id);
    const messages = this.fetchRecentMessages(conversation?.id || null, 25);
    const lead = this.findLead(organizationId, contact.id);
    const aiConfig = this.getAiConfig(organizationId);

    let result: SummarizeConversationResult | null = null;
    const hasValidKey = aiConfig?.provider === 'ollama' || Boolean(aiConfig?.apiKey && aiConfig.apiKey.trim().length > 0);

    // 2. Attempt AI generation if configured
    if (aiConfig && hasValidKey) {
      try {
        const systemPrompt = [
          aiConfig.systemInstructions || 'Você é um assistente de CRM para atendimento via WhatsApp.',
          'Analise o histórico da conversa e produza um resumo estruturado.',
          'Responda estritamente em formato JSON válido contendo exatamente as propriedades:',
          '{"summary": string, "keyPoints": string[], "nextSteps": string[]}',
        ].join('\n');

        const promptParts: string[] = [];
        promptParts.push(`Contato: ${contact.name} (${contact.normalizedPhone})`);
        if (lead) {
          promptParts.push(`Lead: Etapa "${lead.stageName}" | Notas: ${lead.notes || 'Nenhuma'}`);
        }
        promptParts.push(`Mensagens trocadas (${messages.length}):`);
        for (const m of messages) {
          const sender = m.direction === 'inbound' ? 'Contato' : 'Operador';
          promptParts.push(`[${sender}]: ${m.content}`);
        }

        const rawAi = await this.aiCaller({
          provider: aiConfig.provider,
          model: aiConfig.model,
          apiKey: aiConfig.apiKey,
          systemPrompt,
          userPrompt: promptParts.join('\n'),
        });

        if (rawAi) {
          // Extract JSON block if surrounded by markdown code fences
          const cleaned = rawAi.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
          const parsed = JSON.parse(cleaned);
          if (parsed && typeof parsed.summary === 'string' && Array.isArray(parsed.keyPoints)) {
            result = {
              summary: parsed.summary,
              keyPoints: parsed.keyPoints,
              nextSteps: Array.isArray(parsed.nextSteps) ? parsed.nextSteps : [],
            };
          }
        }
      } catch {
        // Fallback on parse or network error
      }
    }

    // 3. Fallback heuristic summary
    if (!result) {
      result = generateFallbackSummary({
        contactName: contact.name,
        phone: contact.normalizedPhone,
        messages,
        leadStageName: lead?.stageName,
        leadNotes: lead?.notes || undefined,
      });
    }

    // 4. Update CRM lead notes if requested
    if (saveAsLeadNote && contact.id) {
      const nowIso = new Date().toISOString();
      const noteEntry = `[Resumo Copiloto - ${nowIso}]:\n${result.summary}\n• Pontos-chave: ${result.keyPoints.join('; ')}\n• Próximos passos: ${result.nextSteps.join('; ')}`;

      const existingLead = this.conn.prepare(`
        SELECT id, notes FROM leads
        WHERE organization_id = ? AND contact_id = ?
        LIMIT 1
      `).get(organizationId, contact.id) as any;

      if (existingLead) {
        const updatedNotes = existingLead.notes ? `${existingLead.notes}\n\n${noteEntry}` : noteEntry;
        this.conn.prepare(`
          UPDATE leads
          SET notes = ?, updated_at = ?
          WHERE id = ? AND organization_id = ?
        `).run(updatedNotes, nowIso, existingLead.id, organizationId);
      } else {
        // Find default funnel to insert new lead with notes
        const funnel = this.conn.prepare(`
          SELECT id, stages FROM funnels
          WHERE organization_id = ?
          ORDER BY created_at ASC
          LIMIT 1
        `).get(organizationId) as any;

        if (funnel) {
          let stageId = 'st_1';
          try {
            const stages = JSON.parse(funnel.stages || '[]');
            if (stages.length > 0 && stages[0]?.id) {
              stageId = stages[0].id;
            }
          } catch {}

          const newLeadId = `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          this.conn.prepare(`
            INSERT INTO leads (id, organization_id, funnel_id, contact_id, stage_id, notes, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(newLeadId, organizationId, funnel.id, contact.id, stageId, noteEntry, nowIso, nowIso);
        }
      }
    }

    return result;
  }
}
