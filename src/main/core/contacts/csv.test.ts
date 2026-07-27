import { describe, it, expect } from 'vitest'
import { decodeCsvBuffer, parseCsv, cell } from './csv'

describe('decodeCsvBuffer', () => {
  it('le UTF-8 preservando acentos', () => {
    const buf = Buffer.from('nome;telefone\nJoão Conceição;11987654210\n', 'utf-8')
    const { text, encoding } = decodeCsvBuffer(buf)
    expect(encoding).toBe('utf-8')
    expect(text).toContain('João Conceição')
  })

  it('detecta latin1 (Excel pt-BR) e nao corrompe acentos', () => {
    const buf = Buffer.from('nome;telefone\nJoão Conceição;11987654210\n', 'latin1')
    const { text, encoding } = decodeCsvBuffer(buf)
    expect(encoding).toBe('latin1')
    expect(text).toContain('João Conceição')
    expect(text).not.toContain('�')
  })

  it('remove o BOM para nao sujar o nome da primeira coluna', () => {
    const buf = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('nome,telefone\nAna,11987654210\n', 'utf-8')
    ])
    const { text } = decodeCsvBuffer(buf)
    expect(parseCsv(text).headers[0]).toBe('nome')
  })
})

describe('parseCsv', () => {
  it('detecta ponto-e-virgula como delimitador', () => {
    const { headers, rows, delimiter } = parseCsv('nome;telefone\nAna;11987654210\n')
    expect(delimiter).toBe(';')
    expect(headers).toEqual(['nome', 'telefone'])
    expect(rows).toEqual([['Ana', '11987654210']])
  })

  it('detecta virgula como delimitador', () => {
    const { headers, delimiter } = parseCsv('nome,telefone\nAna,11987654210\n')
    expect(delimiter).toBe(',')
    expect(headers).toEqual(['nome', 'telefone'])
  })

  it('ignora linhas vazias e nomeia colunas sem header', () => {
    const { headers, rows } = parseCsv('nome;\nAna;11987654210\n\n\nBruno;11912345678\n')
    expect(headers[1]).toBe('Coluna 2')
    expect(rows).toHaveLength(2)
  })

  it('devolve vazio para arquivo sem conteudo', () => {
    expect(parseCsv('').rows).toEqual([])
    expect(parseCsv('\n\n').headers).toEqual([])
  })
})

describe('cell', () => {
  const headers = ['nome', 'telefone', 'empresa']
  it('busca o valor pelo nome do header', () => {
    expect(cell(headers, ['Ana', '11987654210', 'Acme'], 'empresa')).toBe('Acme')
  })
  it('devolve string vazia para header ausente ou nulo', () => {
    expect(cell(headers, ['Ana'], null)).toBe('')
    expect(cell(headers, ['Ana'], 'inexistente')).toBe('')
    expect(cell(headers, ['Ana'], 'telefone')).toBe('')
  })
})
