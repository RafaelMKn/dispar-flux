import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupTestDatabase, type TestContext } from './test-helpers.js';
import {
  IntentClassifier,
  type IntentClassificationResult,
  type AiCaller,
} from '../src/index.js';

describe('Intent and Sentiment Classifier (Block A & ADRs 0030, 0040, 0044)', () => {
  let ctx: TestContext;
  let classifier: IntentClassifier;

  beforeEach(() => {
    ctx = setupTestDatabase();
    classifier = new IntentClassifier(ctx.conn);
  });

  afterEach(() => {
    ctx.conn.close();
  });

  describe('Stage 1: Fast Opt-Out Heuristics', () => {
    it('detects explicit stop and opt-out triggers (case- and accent-insensitive)', async () => {
      const phrases = [
        'pare de me mandar mensagem',
        'PARE IMEDIATAMENTE',
        'Favor remover meu número da base',
        'Remova meu contato agora',
        'Não me chame mais aqui',
        'nao me chame mais',
        'Quero sair da lista',
        'descadastrar por favor',
        'Tirar meu numero agora',
        'stop',
        'Não quero mais receber mensagens',
      ];

      for (const phrase of phrases) {
        const result = await classifier.classify(phrase);
        assert.equal(result.intent, 'opt_out', `Expected opt_out for "${phrase}"`);
        assert.equal(result.recommendedAction, 'apply_opt_out');
        assert.equal(result.confidence, 0.98);
        assert.ok(result.sentiment === 'negative' || result.sentiment === 'hostile');
        assert.ok(result.triggerPhrase, `Expected triggerPhrase for "${phrase}"`);
      }
    });

    it('classifies hostile threats (spam, processo, denunciar, bloquear) as hostile opt_out', async () => {
      const hostilePhrases = [
        'Isso é spam! Vou denunciar vocês!',
        'Vou abrir um processo contra a empresa',
        'Vou bloquear esse número agora mesmo',
        'Parem de mandar spam, vou chamar a polícia',
      ];

      for (const phrase of hostilePhrases) {
        const result = await classifier.classify(phrase);
        assert.equal(result.intent, 'opt_out', `Expected opt_out for "${phrase}"`);
        assert.equal(result.sentiment, 'hostile', `Expected hostile sentiment for "${phrase}"`);
        assert.equal(result.recommendedAction, 'apply_opt_out');
        assert.equal(result.confidence, 0.98);
      }
    });

    it('does NOT trigger false positives on words containing trigger substrings', async () => {
      const safePhrases = [
        'Meu aparelho de celular quebrou',
        'Gostei do acabamento transparente',
        'Podemos fazer um ensaio fotográfico?',
        'O reparo foi concluído com sucesso',
        'Parece uma ótima ideia',
      ];

      for (const phrase of safePhrases) {
        const result = await classifier.classify(phrase);
        assert.notEqual(result.intent, 'opt_out', `Should NOT be opt_out for "${phrase}"`);
        assert.notEqual(result.recommendedAction, 'apply_opt_out');
      }
    });
  });

  describe('Stage 2: Commercial Intent & Sentiment Heuristics', () => {
    it('detects commercial interest and purchase intent', async () => {
      const interestPhrases = [
        'tenho interesse, como faço pra comprar?',
        'Quero comprar o plano anual',
        'Qual o preço e condições de pagamento?',
        'Qual o valor da assinatura?',
        'Quanto custa o serviço?',
        'Tenho muito interesse, manda a proposta!',
        'Quero fechar com vocês agora',
      ];

      for (const phrase of interestPhrases) {
        const result = await classifier.classify(phrase);
        assert.equal(result.intent, 'interested', `Expected interested for "${phrase}"`);
        assert.equal(result.sentiment, 'positive');
        assert.equal(result.recommendedAction, 'move_to_stage');
        assert.ok(result.confidence >= 0.85);
      }
    });

    it('detects meeting and call scheduling requests', async () => {
      const schedulingPhrases = [
        'podemos marcar uma call amanhã?',
        'Podemos agendar uma reunião para conversar?',
        'Qual a sua disponibilidade de horário amanhã?',
        'Vamos marcar um bate-papo esta semana',
        'Gostaria de agendar uma demonstração',
      ];

      for (const phrase of schedulingPhrases) {
        const result = await classifier.classify(phrase);
        assert.equal(result.intent, 'scheduling', `Expected scheduling for "${phrase}"`);
        assert.equal(result.sentiment, 'positive');
        assert.equal(result.recommendedAction, 'notify_operator');
        assert.ok(result.confidence >= 0.85);
      }
    });

    it('detects questions and doubts', async () => {
      const questionPhrases = [
        'como funciona?',
        'Onde fica a loja física de vocês?',
        'Vocês aceitam cartão de crédito ou pix?',
        'Funciona em celulares com sistema iOS?',
        'Qual o horário de atendimento da equipe?',
      ];

      for (const phrase of questionPhrases) {
        const result = await classifier.classify(phrase);
        assert.equal(result.intent, 'question', `Expected question for "${phrase}"`);
        assert.equal(result.sentiment, 'neutral');
        assert.equal(result.recommendedAction, 'notify_operator');
        assert.ok(result.confidence >= 0.75);
      }
    });

    it('detects polite rejection as not_interested', async () => {
      const notInterestedPhrases = [
        'Não tenho interesse no momento, obrigado',
        'Agora não, obrigada',
        'Não quero contratar nada agora',
        'Deixa para a próxima, valeu',
      ];

      for (const phrase of notInterestedPhrases) {
        const result = await classifier.classify(phrase);
        assert.equal(result.intent, 'not_interested', `Expected not_interested for "${phrase}"`);
        assert.equal(result.sentiment, 'negative');
        assert.equal(result.recommendedAction, 'none');
      }
    });

    it('classifies general or neutral messages as unknown', async () => {
      const neutralPhrases = [
        'ok',
        'beleza',
        'bom dia!',
        'entendi perfeitamente',
        'show de bola',
      ];

      for (const phrase of neutralPhrases) {
        const result = await classifier.classify(phrase);
        assert.equal(result.intent, 'unknown', `Expected unknown for "${phrase}"`);
        assert.equal(result.sentiment, 'neutral');
        assert.equal(result.recommendedAction, 'none');
      }
    });
  });

  describe('Stage 2: LLM Inference & DB Config Integration', () => {
    it('uses configured AI provider when present and valid', async () => {
      const now = new Date().toISOString();
      ctx.conn.prepare(`
        INSERT INTO ai_configs (id, organization_id, provider, model_name, api_key_ciphertext, created_at, updated_at)
        VALUES ('ai-test-1', ?, 'openai', 'gpt-4o-mini', 'mock-api-key', ?, ?)
      `).run(ctx.organizationId, now, now);

      const mockAiCaller: AiCaller = async (params) => {
        assert.equal(params.provider, 'openai');
        assert.equal(params.model, 'gpt-4o-mini');
        assert.equal(params.apiKey, 'mock-api-key');
        return JSON.stringify({
          sentiment: 'positive',
          intent: 'interested',
          confidence: 0.95,
          recommendedAction: 'move_to_stage',
        });
      };

      const aiClassifier = new IntentClassifier(ctx.conn, { aiCaller: mockAiCaller });
      const result = await aiClassifier.classify('Quero saber como contratar a ferramenta', {
        organizationId: ctx.organizationId,
      });

      assert.equal(result.intent, 'interested');
      assert.equal(result.sentiment, 'positive');
      assert.equal(result.confidence, 0.95);
      assert.equal(result.recommendedAction, 'move_to_stage');
    });

    it('prioritizes Stage 1 Opt-Out before querying remote LLM', async () => {
      let aiCallerCalled = false;
      const mockAiCaller: AiCaller = async () => {
        aiCallerCalled = true;
        return '{}';
      };

      const aiClassifier = new IntentClassifier(ctx.conn, { aiCaller: mockAiCaller });
      const result = await aiClassifier.classify('PARE DE MANDAR MENSAGEM', {
        organizationId: ctx.organizationId,
      });

      assert.equal(result.intent, 'opt_out');
      assert.equal(result.recommendedAction, 'apply_opt_out');
      assert.equal(aiCallerCalled, false, 'Opt-out should not invoke remote AI');
    });

    it('falls back to heuristics gracefully when LLM fails or throws', async () => {
      const now = new Date().toISOString();
      ctx.conn.prepare(`
        INSERT INTO ai_configs (id, organization_id, provider, model_name, api_key_ciphertext, created_at, updated_at)
        VALUES ('ai-test-2', ?, 'gemini', 'gemini-1.5-flash', 'broken-key', ?, ?)
      `).run(ctx.organizationId, now, now);

      const failingAiCaller: AiCaller = async () => {
        throw new Error('AI Provider 503 Service Unavailable');
      };

      const aiClassifier = new IntentClassifier(ctx.conn, { aiCaller: failingAiCaller });
      const result = await aiClassifier.classify('tenho interesse, como faço pra comprar?', {
        organizationId: ctx.organizationId,
      });

      assert.equal(result.intent, 'interested');
      assert.equal(result.recommendedAction, 'move_to_stage');
      assert.equal(result.sentiment, 'positive');
    });
  });
});
