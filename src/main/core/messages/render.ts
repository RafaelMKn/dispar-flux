/**
 * Renderizador de mensagens — funcoes puras, sem I/O, para serem testaveis.
 *
 * Os tres modos da Fase 1:
 *  - fixa      : um texto com variaveis do contato
 *  - rotacao   : varias mensagens completas, em rodizio
 *  - paragrafo : sorteia uma variacao de cada paragrafo (spintax combinatorio)
 *
 * Variar o texto nao e enfeite: mensagens identicas em volume sao o padrao que
 * o WhatsApp usa para sinalizar spam.
 */

export interface RenderContext {
  name: string | null
  /** Colunas extras do CSV, disponiveis como variaveis. */
  extras: Record<string, string>
  /** Posicao do contato na fila — usada para o rodizio ser deterministico. */
  index: number
}

export interface ParagraphConfig {
  /** Um array de variacoes por paragrafo: [[P1a,P1b], [P2a,P2b], ...] */
  pools: string[][]
}

/**
 * Substitui `[campo]` pelos dados do contato.
 *
 * Suporta fallback: `[nome|cliente]` usa "cliente" quando o nome esta vazio.
 * Sem fallback, a variavel ausente e removida e a pontuacao ao redor e limpa —
 * senao "Oi [nome], tudo bem?" viraria "Oi , tudo bem?".
 */
export function substituteVars(template: string, ctx: RenderContext): string {
  const lookup = (key: string): string => {
    const k = key.trim().toLowerCase()
    if (k === 'nome' || k === 'name') return ctx.name?.trim() ?? ''
    // Busca case-insensitive nos extras.
    const hit = Object.entries(ctx.extras).find(([ek]) => ek.trim().toLowerCase() === k)
    return hit?.[1]?.trim() ?? ''
  }

  const substituted = template.replace(/\[([^\]]+)\]/g, (_all, inner: string) => {
    const [key, fallback] = inner.split('|')
    const value = lookup(key)
    if (value) return value
    return fallback?.trim() ?? ''
  })

  return tidy(substituted)
}

/**
 * Limpa os restos de uma variavel vazia: espaco duplo, espaco antes de
 * pontuacao e virgula orfa no inicio da frase.
 */
export function tidy(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([,.!?;:])/g, '$1')
        .replace(/([,;:])\s*([,.!?;:])/g, '$2')
        .replace(/^\s*[,;:]\s*/, '')
        .trimEnd()
    )
    .join('\n')
    .trim()
}

/** Modo fixa. */
export function renderFixed(text: string, ctx: RenderContext): string {
  return substituteVars(text, ctx)
}

/**
 * Modo rotacao: rodizio deterministico pelo indice.
 *
 * Deterministico de proposito — garante distribuicao uniforme entre as
 * variacoes, o que aleatorio nao garante em lote pequeno.
 */
export function renderRotate(messages: string[], ctx: RenderContext): string {
  const usable = messages.filter((m) => m.trim())
  if (usable.length === 0) return ''
  const pick = usable[ctx.index % usable.length]
  return substituteVars(pick, ctx)
}

/**
 * Modo paragrafo: sorteia uma variacao de cada pool e concatena.
 *
 * Aqui o sorteio e aleatorio (nao ciclico) para nao criar um padrao repetitivo
 * detectavel. `rng` e injetavel para o teste ser deterministico.
 */
export function renderParagraph(
  config: ParagraphConfig,
  ctx: RenderContext,
  rng: () => number = Math.random
): string {
  const pools = config.pools.map((p) => p.filter((v) => v.trim())).filter((p) => p.length > 0)
  if (pools.length === 0) return ''
  const parts = pools.map((pool) => pool[Math.floor(rng() * pool.length) % pool.length])
  return substituteVars(parts.join('\n\n'), ctx)
}

/** Variaveis usadas num template, para a UI mostrar chips clicaveis. */
export function extractVars(template: string): string[] {
  const found = new Set<string>()
  for (const m of template.matchAll(/\[([^\]]+)\]/g)) {
    found.add(m[1].split('|')[0].trim())
  }
  return [...found]
}
