import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSpintax,
  calculateSampleSpace,
  validateEntropy,
  renderSpintax,
} from '../src/entropy/entropy-validator.js';

describe('Message Entropy Validator & Spintax Simulator (Issue #1 / ADR 0060)', () => {
  describe('AST Parsing & Combinatorial Sample Space', () => {
    it('returns sample space 1 for plain text without spintax', () => {
      const template = 'Olá João, tudo bem com você?';
      assert.equal(calculateSampleSpace(template), 1);
    });

    it('calculates combinations for simple single-group Spintax', () => {
      const template = '{Olá|Oi|Bom dia}, tudo bem?';
      assert.equal(calculateSampleSpace(template), 3);
    });

    it('calculates combinations for sequential Spintax groups (multiplicative)', () => {
      const template = '{Olá|Oi|E aí} {amigo|colega|parceiro}, {tudo bem|como vai}?';
      // 3 * 3 * 2 = 18
      assert.equal(calculateSampleSpace(template), 18);
    });

    it('calculates combinations for nested Spintax groups', () => {
      // {Olá|Oi {amigo|colega}} -> branch 1: "Olá" (1), branch 2: "Oi {amigo|colega}" (2) -> total = 3
      const template = '{Olá|Oi {amigo|colega}}!';
      assert.equal(calculateSampleSpace(template), 3);
    });

    it('handles complex nested and sequential combinations correctly', () => {
      // {A|B {C|D}} {E|F} -> (1 + 2) * 2 = 6
      const template = '{A|B {C|D}} {E|F}';
      assert.equal(calculateSampleSpace(template), 6);
    });

    it('preserves template variables without treating them as Spintax', () => {
      const template = '{Olá|Oi} {{nome}}, seu saldo é {{valor}}!';
      assert.equal(calculateSampleSpace(template), 2);
    });

    it('handles escaped braces and pipes as literal characters', () => {
      const template = 'Use \\{estas chaves\\} e \\|barras\\| {normal|correto}';
      assert.equal(calculateSampleSpace(template), 2);
    });

    it('handles empty alternative branches in Spintax', () => {
      // {Olá|} tem 2 ramos (um texto e um vazio)
      const template = '{Olá|} amigo!';
      assert.equal(calculateSampleSpace(template), 2);
    });
  });

  describe('Entropy Risk Classification & Coverage Ratio', () => {
    it('classifies as HIGH risk when coverage ratio R < 0.2', () => {
      // 4 combinações para 100 contatos -> R = 0.04 (< 0.2)
      const template = '{Olá|Oi} {amigo|colega}';
      const result = validateEntropy(template, 100);

      assert.equal(result.sampleSpace, 4);
      assert.equal(result.coverageRatio, 0.04);
      assert.equal(result.riskLevel, 'high');
      assert.ok(result.suggestions.length > 0);
      assert.match(result.suggestions[0]!, /espaço amostral/i);
    });

    it('provides basic guidance suggestions when template has zero Spintax and high risk', () => {
      const template = 'Mensagem estática sem nenhuma variação.';
      const result = validateEntropy(template, 50);

      assert.equal(result.sampleSpace, 1);
      assert.equal(result.riskLevel, 'high');
      assert.ok(result.suggestions.some((s) => s.includes('saudação')));
    });

    it('classifies as MODERATE risk when 0.2 <= R < 0.8', () => {
      // 10 combinações para 20 contatos -> R = 0.5
      // Template com 2 * 5 = 10 combinações
      const template = '{Olá|Oi} {A|B|C|D|E}';
      const result = validateEntropy(template, 20);

      assert.equal(result.sampleSpace, 10);
      assert.equal(result.coverageRatio, 0.5);
      assert.equal(result.riskLevel, 'moderate');
      assert.ok(result.suggestions.some((s) => s.includes('moderada')));
    });

    it('classifies as LOW risk when R >= 0.8', () => {
      // 18 combinações para 20 contatos -> R = 0.9 (>= 0.8)
      const template = '{Olá|Oi|E aí} {amigo|colega|parceiro}, {tudo bem|como vai}?';
      const result = validateEntropy(template, 20);

      assert.equal(result.sampleSpace, 18);
      assert.equal(result.coverageRatio, 0.9);
      assert.equal(result.riskLevel, 'low');
    });

    it('classifies as LOW risk if AI Mode is active regardless of Spintax coverage', () => {
      const template = 'Mensagem estática mas com personalização de IA ativa.';
      const result = validateEntropy(template, 500, { hasAiMode: true });

      assert.equal(result.sampleSpace, 1);
      assert.equal(result.riskLevel, 'low');
    });
  });

  describe('Spintax Message Rendering', () => {
    it('deterministically selects branches with custom randomFn', () => {
      const template = '{Primeiro|Segundo|Terceiro}';
      // randomFn retornando 0 -> seleciona o primeiro
      assert.equal(renderSpintax(template, () => 0.0), 'Primeiro');
      // randomFn retornando 0.5 -> floor(0.5 * 3) = 1 -> 'Segundo'
      assert.equal(renderSpintax(template, () => 0.5), 'Segundo');
      // randomFn retornando 0.99 -> floor(0.99 * 3) = 2 -> 'Terceiro'
      assert.equal(renderSpintax(template, () => 0.99), 'Terceiro');
    });

    it('resolves nested spintax recursively', () => {
      const template = '{A|B {C|D}}';
      // Selecionando ramo 1 ("B {C|D}") e sub-ramo 0 ("C")
      let callCount = 0;
      const customRandom = () => {
        callCount++;
        return callCount === 1 ? 0.9 : 0.1; // primeiro nível = B, segundo nível = C
      };
      assert.equal(renderSpintax(template, customRandom), 'B C');
    });

    it('preserves literal text and template variables in rendering', () => {
      const template = '{Olá|Oi} {{nome}}, bem-vindo!';
      const rendered = renderSpintax(template, () => 0.0);
      assert.equal(rendered, 'Olá {{nome}}, bem-vindo!');
    });
  });
});
