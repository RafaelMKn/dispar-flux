import Papa from 'papaparse'

/**
 * Leitura de CSV pensada para a realidade brasileira: o Excel pt-BR exporta
 * "CSV" com `;` como delimitador e em Windows-1252 (latin1), nao UTF-8. Ler
 * como UTF-8 nesse caso corrompe todo acento ("Joao" -> "Jo�o").
 */

export interface DecodedCsv {
  text: string
  encoding: 'utf-8' | 'latin1'
}

/**
 * Decodifica o buffer detectando o encoding.
 *
 * Estrategia: tenta UTF-8 estrito; se aparecer o caractere de substituicao
 * (U+FFFD), o arquivo nao era UTF-8 valido, entao relemos como latin1.
 * Tambem remove o BOM, que viraria parte do nome da primeira coluna.
 */
export function decodeCsvBuffer(buf: Buffer): DecodedCsv {
  const utf8 = new TextDecoder('utf-8').decode(buf)
  if (!utf8.includes('�')) {
    return { text: stripBom(utf8), encoding: 'utf-8' }
  }
  const latin1 = new TextDecoder('latin1').decode(buf)
  return { text: stripBom(latin1), encoding: 'latin1' }
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
  delimiter: string
}

/**
 * Faz o parse com deteccao automatica de delimitador (`,` `;` tab `|`).
 * Linhas totalmente vazias sao descartadas.
 */
export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', ';', '\t', '|']
  })

  const data = (result.data ?? []).filter((r) => Array.isArray(r) && r.some((c) => c?.trim()))
  if (data.length === 0) return { headers: [], rows: [], delimiter: ',' }

  const headers = data[0].map((h, i) => (h?.trim() ? h.trim() : `Coluna ${i + 1}`))
  const rows = data.slice(1)
  return { headers, rows, delimiter: result.meta?.delimiter ?? ',' }
}

/** Valor de uma coluna (por nome de header) numa linha. */
export function cell(headers: string[], row: string[], header: string | null): string {
  if (!header) return ''
  const idx = headers.indexOf(header)
  if (idx < 0) return ''
  return (row[idx] ?? '').trim()
}
