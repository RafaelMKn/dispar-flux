/**
 * Modelo de planilha para o usuario preencher.
 *
 * Duas decisoes de formato, ambas para o arquivo abrir certo no Excel pt-BR —
 * que e onde ele vai ser preenchido na pratica:
 *
 *  - **BOM UTF-8**: sem ele o Excel assume a codificacao do sistema (latin1) e
 *    exibe "Joao" como "JoÃ£o". Com BOM, abre com acento correto.
 *  - **`;` como separador**: e o que o Excel em portugues espera; com virgula
 *    ele joga a linha inteira numa celula so.
 *
 * O nosso proprio importador detecta as duas coisas, entao o arquivo volta sem
 * atrito.
 */

export const TEMPLATE_HEADERS = ['nome', 'telefone', 'empresa', 'cidade'] as const

const EXAMPLE_ROWS: string[][] = [
  ['João Conceição', '(11) 98765-4210', 'Cortez Móveis', 'São Paulo'],
  ['Ana Ferrão', '11912345678', 'Beta Ltda', 'Porto Alegre'],
  ['Luís Ávila', '+55 51 3255-4210', 'Gama SA', 'Curitiba']
]

const BOM = '﻿'

/** Escapa a celula no padrao CSV (aspas e separador dentro do texto). */
function escapeCell(v: string): string {
  return /[";\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export function buildTemplateCsv(): Buffer {
  const lines = [TEMPLATE_HEADERS.join(';'), ...EXAMPLE_ROWS.map((r) => r.map(escapeCell).join(';'))]
  // \r\n: o Excel lida melhor com quebra de linha do Windows.
  return Buffer.from(BOM + lines.join('\r\n') + '\r\n', 'utf-8')
}

export const TEMPLATE_FILENAME = 'modelo-contatos-dispar-flux.csv'

/** Monta um CSV no mesmo formato do modelo (BOM + `;`), a partir de linhas. */
export function toCsvBuffer(headers: string[], rows: string[][]): Buffer {
  const lines = [
    headers.map(escapeCell).join(';'),
    ...rows.map((r) => r.map((c) => escapeCell(c ?? '')).join(';'))
  ]
  return Buffer.from(BOM + lines.join('\r\n') + '\r\n', 'utf-8')
}
