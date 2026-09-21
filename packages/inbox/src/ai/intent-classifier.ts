import type { DatabaseConnection } from '@dispar-flux/database';
import { type AiCaller, type AiProviderType, defaultAiCaller } from './copilot-service.js';

export interface IntentClassificationResult {
  sentiment: 'positive' | 'neutral' | 'negative' | 'hostile';
  intent: 'opt_out' | 'interested' | 'question' | 'scheduling' | 'not_interested' | 'unknown';
  confidence: number; // 0.00 a 1.00
  triggerPhrase?: string;
  recommendedAction: 'apply_opt_out' | 'move_to_stage' | 'notify_operator' | 'none';
  targetStageId?: string;
}

export interface IntentClassifierOptions {
  conn?: DatabaseConnection;
  aiCaller?: AiCaller;
}

interface OptOutRule {
  regex: RegExp;
  phrase: string;
  sentiment: 'hostile' | 'negative';
}

const OPT_OUT_RULES: OptOutRule[] = [
  // Hostile / legal threats / harassment / spam
  { regex: /\b(spam)\b/i, phrase: 'spam', sentiment: 'hostile' },
  { regex: /\b(processo|processar|vou\s+processar)\b/i, phrase: 'processo', sentiment: 'hostile' },
  { regex: /\b(denunciar|denuncia|denúncia|vou\s+denunciar)\b/i, phrase: 'denunciar', sentiment: 'hostile' },
  { regex: /\b(bloquear|bloqueado|bloqueada|vou\s+bloquear)\b/i, phrase: 'bloquear', sentiment: 'hostile' },
  { regex: /\b(policia|polícia|procon|crime|golpe)\b/i, phrase: 'denunciar', sentiment: 'hostile' },

  // Explicit opt-out / stop phrases
  { regex: /\b(nao\s+me\s+chame\s+mais|nao\s+me\s+chamem\s+mais)\b/i, phrase: 'nao me chame mais', sentiment: 'negative' },
  { regex: /\b(nao\s+me\s+mande\s+mais|nao\s+mande\s+mais|nao\s+manda\s+mais)\b/i, phrase: 'nao me mande mais', sentiment: 'negative' },
  { regex: /\b(nao\s+quero\s+mais\s+receber)\b/i, phrase: 'nao quero mais receber', sentiment: 'negative' },
  { regex: /\b(tirar\s+meu\s+numero|tira\s+meu\s+numero|tirar\s+meu\s+contato|tira\s+meu\s+contato)\b/i, phrase: 'tirar meu numero', sentiment: 'negative' },
  { regex: /\b(remover\s+meu\s+numero|remova\s+meu\s+numero|remover\s+meu\s+contato|remova\s+meu\s+contato)\b/i, phrase: 'remover meu numero', sentiment: 'negative' },
  { regex: /\b(descadastrar|descadastre|descadastramento)\b/i, phrase: 'descadastrar', sentiment: 'negative' },
  { regex: /\b(remover|remova)\b/i, phrase: 'remover', sentiment: 'negative' },
  { regex: /\b(pare|parar|parem)\b/i, phrase: 'pare', sentiment: 'negative' },
  { regex: /\b(sair)\b/i, phrase: 'sair', sentiment: 'negative' },
  { regex: /\b(stop)\b/i, phrase: 'stop', sentiment: 'negative' },
];

const NOT_INTERESTED_PATTERNS = [
  /\b(nao\s+tenho\s+interesse|sem\s+interesse|nao\s+estou\s+interessad[oa]|nao\s+tenho\s+interece)\b/i,
  /\b(obrigad[oa]\s+mas\s+nao|nao\s+obrigad[oa]|agora\s+nao\s+obrigad[oa]|agora\s+nao)\b/i,
  /\b(nao\s+quero|nao\s+preciso|nao\s+tenho\s+necessidade)\b/i,
  /\b(deixa\s+pra\s+proxima|deixa\s+para\s+a\s+proxima|ja\s+tenho|ja\s+temos)\b/i,
  /\b(no\s+momento\s+nao)\b/i,
];

const SCHEDULING_PATTERNS = [
  /\b(podemos\s+marcar|vamos\s+marcar|marcar\s+(uma\s+)?(call|reuniao|conversa|horario|bate-papo|bate\s+papo))\b/i,
  /\b(agendar|agendamento|agende|marcar\s+agenda)\b/i,
  /\b(call\s+amanha|reuniao\s+amanha|horario\s+amanha|conversar\s+amanha)\b/i,
  /\b(disponibilidade\s+de\s+horario|qual\s+(seu|o\s+seu)\s+horario)\b/i,
  /\b(marcar\s+uma\s+reuniao|marcar\s+uma\s+call)\b/i,
];

const INTERESTED_PATTERNS = [
  /\b(tenho\s+interesse|muito\s+interesse|super\s+interesse|estou\s+interessad[oa])\b/i,
  /\b(como\s+fac[oa]\s+pra\s+comprar|como\s+fac[oa]\s+para\s+comprar|quero\s+comprar|quero\s+adquirir)\b/i,
  /\b(quero\s+contratar|quero\s+assinar|quero\s+fechar|vamos\s+fechar|onde\s+compro)\b/i,
  /\b(qual\s+o\s+preco|qual\s+o\s+valor|quanto\s+custa|preco\s+e\s+planos|tabela\s+de\s+precos?)\b/i,
  /\b(manda\s+(o\s+link|a\s+proposta|o\s+orcamento)|envia\s+(a\s+proposta|o\s+orcamento))\b/i,
  /\b(gostei|adorei|quero\s+saber\s+mais|me\s+interessa)\b/i,
  /\b(como\s+posso\s+comprar|onde\s+pago|link\s+de\s+pagamento)\b/i,
];

const QUESTION_PATTERNS = [
  /\b(como\s+funciona|como\s+e\s+que\s+funciona)\b/i,
  /\b(onde\s+fica|onde\s+voces\s+estao|qual\s+o\s+endereco)\b/i,
  /\b(aceita\s+cartao|aceitam\s+pix|formas?\s+de\s+pagamento)\b/i,
  /\b(tem\s+garantia|como\s+e\s+o\s+suporte|tem\s+suporte)\b/i,
  /\b(funciona\s+(em|no)|e\s+compativel)\b/i,
  /\b(duvida|tenho\s+uma\s+duvida|pergunta)\b/i,
];

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * High-performance, offline-first Intent and Sentiment Classifier with Opt-Out safety.
 *
 * Stage 1: Instant, zero-latency heuristic evaluation for explicit stop triggers (ADR 0040).
 * Stage 2: Contextual heuristic engine or LLM integration (OpenAI, Gemini, Groq, Ollama)
 *          for commercial intent classification and CRM stage transitions.
 */
export class IntentClassifier {
  private readonly conn?: DatabaseConnection;
  private readonly aiCaller: AiCaller;

  constructor(connOrOptions?: DatabaseConnection | IntentClassifierOptions, maybeOptions?: IntentClassifierOptions) {
    if (connOrOptions && 'prepare' in connOrOptions) {
      this.conn = connOrOptions as DatabaseConnection;
      this.aiCaller = maybeOptions?.aiCaller || defaultAiCaller;
    } else if (connOrOptions) {
      const opts = connOrOptions as IntentClassifierOptions;
      this.conn = opts.conn;
      this.aiCaller = opts.aiCaller || defaultAiCaller;
    } else {
      this.conn = undefined;
      this.aiCaller = defaultAiCaller;
    }
  }

  /**
   * Evaluates message content for Opt-Out triggers.
   */
  private evaluateOptOut(normalized: string, originalText: string): IntentClassificationResult | null {
    for (const rule of OPT_OUT_RULES) {
      const match = rule.regex.exec(normalized);
      if (match) {
        // Try to locate original casing if possible, or fallback to rule phrase
        const matchedSnippet = match[0] || rule.phrase;
        return {
          sentiment: rule.sentiment,
          intent: 'opt_out',
          confidence: 0.98,
          triggerPhrase: matchedSnippet,
          recommendedAction: 'apply_opt_out',
        };
      }
    }
    return null;
  }

  /**
   * Evaluates message content for commercial intent using semantic heuristics.
   */
  private evaluateHeuristics(normalized: string, originalText: string): IntentClassificationResult {
    // 1. Check Not Interested
    for (const pattern of NOT_INTERESTED_PATTERNS) {
      if (pattern.test(normalized)) {
        return {
          sentiment: 'negative',
          intent: 'not_interested',
          confidence: 0.90,
          recommendedAction: 'none',
        };
      }
    }

    // 2. Check Scheduling
    for (const pattern of SCHEDULING_PATTERNS) {
      if (pattern.test(normalized)) {
        return {
          sentiment: 'positive',
          intent: 'scheduling',
          confidence: 0.90,
          recommendedAction: 'notify_operator',
        };
      }
    }

    // 3. Check Commercial Interest
    for (const pattern of INTERESTED_PATTERNS) {
      if (pattern.test(normalized)) {
        return {
          sentiment: 'positive',
          intent: 'interested',
          confidence: 0.92,
          recommendedAction: 'move_to_stage',
        };
      }
    }

    // 4. Check Question / Doubt
    const hasQuestionMark = originalText.includes('?');
    let hasQuestionPattern = false;
    for (const pattern of QUESTION_PATTERNS) {
      if (pattern.test(normalized)) {
        hasQuestionPattern = true;
        break;
      }
    }
    const hasInterrogativeWord = /\b(como|quando|onde|qual|quais|quanto|quantos|por\s*que|porque|oque|o\s+que)\b/i.test(normalized);

    if (hasQuestionPattern || (hasQuestionMark && hasInterrogativeWord) || hasQuestionMark) {
      return {
        sentiment: 'neutral',
        intent: 'question',
        confidence: hasQuestionPattern ? 0.88 : 0.80,
        recommendedAction: 'notify_operator',
      };
    }

    // 5. Unknown / Neutral
    return {
      sentiment: 'neutral',
      intent: 'unknown',
      confidence: 0.50,
      recommendedAction: 'none',
    };
  }

  /**
   * Fetches AI config from DB if organizationId and connection are present.
   */
  private getAiConfig(organizationId: string) {
    if (!this.conn) return null;
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
   * Classifies a message for sentiment, intent, confidence, and recommended action.
   */
  async classify(
    text: string,
    options?: { organizationId?: string; context?: Record<string, unknown> }
  ): Promise<IntentClassificationResult> {
    const rawText = (text || '').trim();
    const normalized = normalizeText(rawText);

    // ------------------------------------------------------------------------
    // Stage 1: High-Priority Heuristic Opt-Out Check (ADR 0040, ADR 0044)
    // ------------------------------------------------------------------------
    const optOutResult = this.evaluateOptOut(normalized, rawText);
    if (optOutResult) {
      return optOutResult;
    }

    // ------------------------------------------------------------------------
    // Stage 2: Commercial Intent & Sentiment (LLM or Heuristic Engine)
    // ------------------------------------------------------------------------
    // Attempt LLM inference if configured
    if (options?.organizationId && this.conn) {
      const aiConfig = this.getAiConfig(options.organizationId);
      const hasValidKey = aiConfig?.provider === 'ollama' || Boolean(aiConfig?.apiKey && aiConfig.apiKey.trim().length > 0);

      if (aiConfig && hasValidKey) {
        try {
          const systemPrompt = [
            'Você é um classificador de intenção e sentimento de mensagens de clientes no WhatsApp para CRM e Atendimento Comercial.',
            'Classifique a mensagem recebida e responda ESTRITAMENTE em formato JSON com as propriedades:',
            '{',
            '  "sentiment": "positive" | "neutral" | "negative" | "hostile",',
            '  "intent": "opt_out" | "interested" | "question" | "scheduling" | "not_interested" | "unknown",',
            '  "confidence": number, // entre 0.00 e 1.00',
            '  "recommendedAction": "apply_opt_out" | "move_to_stage" | "notify_operator" | "none"',
            '}',
            'Regras:',
            '- Se expressar interesse de compra/valores/proposta: intent="interested", recommendedAction="move_to_stage"',
            '- Se for dúvida: intent="question", recommendedAction="notify_operator"',
            '- Se for agendamento de call/reunião: intent="scheduling", recommendedAction="notify_operator"',
            '- Se for desinteresse: intent="not_interested", recommendedAction="none"',
            '- Se for pedido de parada/saída: intent="opt_out", recommendedAction="apply_opt_out"',
          ].join('\n');

          const userPrompt = `Mensagem do cliente: "${rawText}"`;

          const aiResponse = await this.aiCaller({
            provider: aiConfig.provider,
            model: aiConfig.model,
            apiKey: aiConfig.apiKey,
            systemPrompt,
            userPrompt,
          });

          if (aiResponse) {
            const cleaned = aiResponse.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
            const parsed = JSON.parse(cleaned);
            const validSentiments = ['positive', 'neutral', 'negative', 'hostile'];
            const validIntents = ['opt_out', 'interested', 'question', 'scheduling', 'not_interested', 'unknown'];
            const validActions = ['apply_opt_out', 'move_to_stage', 'notify_operator', 'none'];

            if (
              validSentiments.includes(parsed.sentiment) &&
              validIntents.includes(parsed.intent) &&
              validActions.includes(parsed.recommendedAction)
            ) {
              const confidence = typeof parsed.confidence === 'number'
                ? Math.min(1.0, Math.max(0.0, parsed.confidence))
                : 0.85;

              return {
                sentiment: parsed.sentiment,
                intent: parsed.intent,
                confidence,
                triggerPhrase: parsed.triggerPhrase || undefined,
                recommendedAction: parsed.recommendedAction,
                targetStageId: typeof options?.context?.targetStageId === 'string' ? options.context.targetStageId : undefined,
              };
            }
          }
        } catch {
          // Graceful fallback to heuristic engine on any LLM/network error
        }
      }
    }

    // Heuristic contextual fallback
    const result = this.evaluateHeuristics(normalized, rawText);
    if (typeof options?.context?.targetStageId === 'string') {
      result.targetStageId = options.context.targetStageId;
    }
    return result;
  }
}
