/**
 * Message Entropy Validator & Spintax Simulator (Issue #1 / ADR 0060)
 *
 * Implements lexical entropy validation, combinatorial sample space calculation
 * for sequential and nested Spintax groups, dynamic message spinning, and risk classification.
 */

export interface SpintaxTextNode {
  type: 'text';
  value: string;
}

export interface SpintaxGroupNode {
  type: 'group';
  alternatives: SpintaxNode[][];
}

export type SpintaxNode = SpintaxTextNode | SpintaxGroupNode;

export type RiskLevel = 'low' | 'moderate' | 'high';

export interface EntropyValidationOptions {
  hasAiMode?: boolean;
}

export interface EntropyValidationResult {
  sampleSpace: number;
  coverageRatio: number;
  riskLevel: RiskLevel;
  suggestions: string[];
}

/**
 * Parses a template string into a structured Spintax Abstract Syntax Tree (AST).
 * Handles:
 * - Nested spintaxes: {Olá|Oi {amigo|colega}}
 * - Sequential spintaxes: {Olá|Oi} {tudo bem|como vai}
 * - Template variables: {{nome}}, {{telefone}} are preserved as literal text
 * - Escaped characters: \{, \}, \|
 * - Empty alternatives: {Olá|}
 */
export function parseSpintax(template: string): SpintaxNode[] {
  if (!template || typeof template !== 'string') {
    return [];
  }

  const nodes: SpintaxNode[] = [];
  let currentText = '';
  let i = 0;

  const flushText = () => {
    if (currentText.length > 0) {
      nodes.push({ type: 'text', value: currentText });
      currentText = '';
    }
  };

  while (i < template.length) {
    // 1. Check for template variable tag {{variable_name}}
    if (template[i] === '{' && template[i + 1] === '{') {
      const rest = template.slice(i);
      const varMatch = rest.match(/^\{\{\s*[a-zA-Z0-9_\u00C0-\u017F-]+\s*\}\}/);
      if (varMatch) {
        currentText += varMatch[0];
        i += varMatch[0].length;
        continue;
      }
    }

    // 2. Check for escaped characters \{, \}, \|, \\
    if (template[i] === '\\' && i + 1 < template.length && ['{', '}', '|', '\\'].includes(template[i + 1]!)) {
      currentText += template[i + 1];
      i += 2;
      continue;
    }

    // 3. Check for potential Spintax group opening '{'
    if (template[i] === '{') {
      const match = findMatchingBrace(template, i);
      if (match && match.hasPipe) {
        flushText();
        const groupContent = template.slice(i + 1, match.closeIndex);
        const altStrings = splitAlternatives(groupContent);
        const alternatives = altStrings.map((alt) => parseSpintax(alt));
        nodes.push({ type: 'group', alternatives });
        i = match.closeIndex + 1;
        continue;
      }
    }

    // 4. Regular literal character
    currentText += template[i];
    i++;
  }

  flushText();
  return nodes;
}

/**
 * Scans ahead from an opening '{' to locate its matching closing '}'.
 * Verifies if at least one pipe '|' exists at depth 1 (i.e. between the choices).
 */
function findMatchingBrace(
  input: string,
  openIndex: number
): { closeIndex: number; hasPipe: boolean } | null {
  let depth = 1;
  let hasPipeAtDepth1 = false;
  let j = openIndex + 1;

  while (j < input.length) {
    // Skip template variables {{variable_name}}
    if (input[j] === '{' && input[j + 1] === '{') {
      const rest = input.slice(j);
      const varMatch = rest.match(/^\{\{\s*[a-zA-Z0-9_\u00C0-\u017F-]+\s*\}\}/);
      if (varMatch) {
        j += varMatch[0].length;
        continue;
      }
    }

    // Skip escaped characters
    if (input[j] === '\\' && j + 1 < input.length && ['{', '}', '|', '\\'].includes(input[j + 1]!)) {
      j += 2;
      continue;
    }

    if (input[j] === '{') {
      depth++;
      j++;
    } else if (input[j] === '}') {
      depth--;
      if (depth === 0) {
        return { closeIndex: j, hasPipe: hasPipeAtDepth1 };
      }
      j++;
    } else if (input[j] === '|') {
      if (depth === 1) {
        hasPipeAtDepth1 = true;
      }
      j++;
    } else {
      j++;
    }
  }

  return null;
}

/**
 * Splits a group's content into alternative branches based on pipes at depth 0.
 */
function splitAlternatives(content: string): string[] {
  const alternatives: string[] = [];
  let current = '';
  let depth = 0;
  let k = 0;

  while (k < content.length) {
    // Skip template variables {{variable_name}}
    if (content[k] === '{' && content[k + 1] === '{') {
      const rest = content.slice(k);
      const varMatch = rest.match(/^\{\{\s*[a-zA-Z0-9_\u00C0-\u017F-]+\s*\}\}/);
      if (varMatch) {
        current += varMatch[0];
        k += varMatch[0].length;
        continue;
      }
    }

    // Preserve escaped characters
    if (content[k] === '\\' && k + 1 < content.length && ['{', '}', '|', '\\'].includes(content[k + 1]!)) {
      current += content[k]! + content[k + 1]!;
      k += 2;
      continue;
    }

    if (content[k] === '{') {
      depth++;
      current += '{';
      k++;
    } else if (content[k] === '}') {
      depth--;
      current += '}';
      k++;
    } else if (content[k] === '|' && depth === 0) {
      alternatives.push(current);
      current = '';
      k++;
    } else {
      current += content[k];
      k++;
    }
  }

  alternatives.push(current);
  return alternatives;
}

/**
 * Calculates the total combinatorial sample space (C) of a template.
 * - Sequential spintaxes multiply: {A|B} {C|D} = 2 * 2 = 4
 * - Nested spintaxes sum within alternatives: {Olá|Oi {amigo|colega}} = 1 + (1 * 2) = 3
 * - Returns 1 if no spintax exists or template is empty.
 */
export function calculateSampleSpace(template: string): number {
  if (!template || typeof template !== 'string') return 1;
  const nodes = parseSpintax(template);
  return calculateNodesSampleSpace(nodes);
}

function calculateNodesSampleSpace(nodes: SpintaxNode[]): number {
  if (nodes.length === 0) return 1;

  let totalCombinations = 1;

  for (const node of nodes) {
    if (node.type === 'group') {
      let groupSum = 0;
      for (const alt of node.alternatives) {
        groupSum += calculateNodesSampleSpace(alt);
      }
      // If group has alternatives, multiply total combinations
      totalCombinations *= groupSum > 0 ? groupSum : 1;
    }
  }

  return totalCombinations;
}

/**
 * Validates the lexical entropy and anti-ban deliverability risk for a campaign.
 *
 * @param template Message template with optional Spintax
 * @param contactCount Number of targeted recipients
 * @param options Configuration options, e.g. hasAiMode
 * @returns EntropyValidationResult with sampleSpace, coverageRatio, riskLevel, suggestions
 */
export function validateEntropy(
  template: string,
  contactCount: number,
  options?: EntropyValidationOptions
): EntropyValidationResult {
  const sampleSpace = calculateSampleSpace(template);
  const totalContacts = Math.max(0, Number(contactCount) || 0);

  const coverageRatio = totalContacts > 0 ? sampleSpace / totalContacts : 1;
  const hasAi = Boolean(options?.hasAiMode);

  let riskLevel: RiskLevel;
  if (hasAi || coverageRatio >= 0.8) {
    riskLevel = 'low';
  } else if (coverageRatio >= 0.2 && coverageRatio < 0.8) {
    riskLevel = 'moderate';
  } else {
    riskLevel = 'high';
  }

  const suggestions: string[] = [];

  if (riskLevel === 'high') {
    if (sampleSpace <= 1) {
      suggestions.push('Adicione variações de saudação no início da mensagem (ex: {Olá|Oi|Bom dia}).');
      suggestions.push('Adicione variações no corpo do texto ou na chamada para ação (CTA).');
      suggestions.push('Inclua opções alternativas de fechamento/despedida da mensagem.');
      suggestions.push('Considere ativar o Modo IA para gerar mensagens únicas por contato.');
    } else {
      suggestions.push(
        `O espaço amostral atual (${sampleSpace} combinações) cobre apenas ${(coverageRatio * 100).toFixed(1)}% dos ${totalContacts} contatos.`
      );
      suggestions.push(
        'Aumente as variações no corpo do texto para atingir pelo menos 20% de cobertura (mínimo recomendado para reduzir riscos de bloqueio).'
      );
      suggestions.push(
        'Utilize Spintax aninhado para multiplicar o número de combinações (ex: {Olá|Oi {amigo|colega}}).'
      );
      suggestions.push(
        'Ative o Modo IA para dispensar Spintax manual e garantir variação dinâmica ilimitada.'
      );
    }
  } else if (riskLevel === 'moderate') {
    suggestions.push(
      `A cobertura de variações é moderada (${(coverageRatio * 100).toFixed(1)}%). Recomendamos atingir 80% ou mais para máxima segurança.`
    );
    suggestions.push('Adicione sinônimos adicionais nos grupos de Spintax existentes.');
    suggestions.push('Adicione variações de pontuação ou conectivos no texto.');
    suggestions.push('Considere ativar o Modo IA para elevar a personalização a 100%.');
  }

  return {
    sampleSpace,
    coverageRatio,
    riskLevel,
    suggestions,
  };
}

/**
 * Resolves a template containing Spintax into a concrete randomized message.
 * Recursively resolves nested Spintax groups and picks an alternative at each level.
 *
 * @param template Template string with Spintax
 * @param randomFn Optional custom random function (defaults to Math.random) for deterministic tests
 */
export function renderSpintax(
  template: string,
  randomFn: () => number = Math.random
): string {
  if (!template || typeof template !== 'string') return '';
  const nodes = parseSpintax(template);
  return renderNodes(nodes, randomFn);
}

function renderNodes(nodes: SpintaxNode[], randomFn: () => number): string {
  let result = '';

  for (const node of nodes) {
    if (node.type === 'text') {
      result += node.value;
    } else if (node.type === 'group') {
      if (node.alternatives.length === 0) continue;
      const idx = Math.min(
        node.alternatives.length - 1,
        Math.max(0, Math.floor(randomFn() * node.alternatives.length))
      );
      const chosenAlt = node.alternatives[idx]!;
      result += renderNodes(chosenAlt, randomFn);
    }
  }

  return result;
}
