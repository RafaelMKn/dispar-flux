/**
 * Utilitarios de texto para a tela de Documentacao: transformar titulos em
 * ancoras estaveis, montar o sumario e preparar o markdown para renderizar.
 */

export interface TocEntry {
  /** 2 = secao, 3 = subsecao. */
  depth: 2 | 3
  text: string
  id: string
}

/**
 * Transforma um titulo em id de ancora: minusculas, sem acento, sem pontuacao.
 *
 * O renderizador chama esta mesma funcao para o `id` do <h2>/<h3>, entao ela e
 * o contrato entre o sumario e o corpo do texto. Como o id sai so do texto
 * (sem contador de repeticao, que dependeria da ordem de renderizacao e
 * quebraria no StrictMode), dois titulos identicos no mesmo guia dividiriam a
 * mesma ancora — evite repetir titulo dentro de um arquivo.
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Texto visivel de um titulo: sem marcacao de negrito, codigo ou link. */
export function plainText(raw: string): string {
  return raw
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_]{1,3}/g, '')
    .trim()
}

/**
 * Le os titulos de nivel 2 e 3 do markdown. Linhas dentro de bloco de codigo
 * sao ignoradas — `# comentario` num exemplo de shell nao e um titulo.
 */
export function extractToc(markdown: string): TocEntry[] {
  const entries: TocEntry[] = []
  let inCode = false

  for (const line of markdown.split('\n')) {
    if (line.startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) continue

    const match = /^(#{2,3})\s+(.*)$/.exec(line)
    if (!match) continue

    const text = plainText(match[2])
    if (!text) continue

    entries.push({ depth: match[1].length === 2 ? 2 : 3, text, id: slugify(text) })
  }

  return entries
}

/**
 * Remove o primeiro titulo de nivel 1 do markdown: na tela ele ja aparece no
 * cabecalho da pagina, entao repeti-lo no corpo seria titulo duplicado.
 */
export function stripTitle(markdown: string): string {
  return markdown.replace(/^\s*#\s+.*(\r?\n)+/, '')
}

/** Estimativa de leitura em minutos, arredondada (minimo 1). */
export function readingMinutes(markdown: string): number {
  const words = markdown.trim().split(/\s+/).length
  return Math.max(1, Math.round(words / 200))
}
