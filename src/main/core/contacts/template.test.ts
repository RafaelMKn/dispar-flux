import { describe, it, expect } from 'vitest'
import { buildTemplateCsv, TEMPLATE_HEADERS } from './template'
import { decodeCsvBuffer, parseCsv } from './csv'
import { normalizePhone } from './phone'

describe('buildTemplateCsv', () => {
  it('começa com BOM UTF-8 (senao o Excel pt-BR corrompe os acentos)', () => {
    const buf = buildTemplateCsv()
    expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf])
  })

  it('usa ponto e virgula, que e o separador do Excel em portugues', () => {
    const { text } = decodeCsvBuffer(buildTemplateCsv())
    expect(parseCsv(text).delimiter).toBe(';')
  })

  it('o proprio importador le o modelo de volta sem atrito', () => {
    // Fecha o ciclo: o arquivo que geramos tem de ser aceito pelo nosso parser.
    const { text, encoding } = decodeCsvBuffer(buildTemplateCsv())
    expect(encoding).toBe('utf-8')

    const { headers, rows } = parseCsv(text)
    expect(headers).toEqual([...TEMPLATE_HEADERS])
    expect(rows.length).toBeGreaterThan(0)

    // Acentos preservados e telefones de exemplo validos.
    expect(text).toContain('João Conceição')
    for (const row of rows) {
      expect(normalizePhone(row[1]), row[1]).not.toBeNull()
    }
  })
})
