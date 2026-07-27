import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initDb } from '../../db'
import { createContactList } from '../../repos/contactLists'
import { addOptOut } from '../../repos/optOuts'
import { listStats } from '../../repos/contacts'
import { buildPreview, importCsv, guessMapping } from './import'

const dir = mkdtempSync(join(tmpdir(), 'csv-fixtures-'))

/** Escreve um CSV como o Excel pt-BR faria: `;` e latin1. */
function writeExcelBrCsv(name: string, content: string): string {
  const p = join(dir, name)
  writeFileSync(p, Buffer.from(content, 'latin1'))
  return p
}

beforeAll(async () => {
  await initDb()
})

describe('importCsv', () => {
  it('importa CSV do Excel pt-BR preservando acentos e normalizando telefones', async () => {
    const file = writeExcelBrCsv(
      'leads.csv',
      [
        'nome;telefone;empresa',
        'João Conceição;(11) 98765-4210;Acme',
        'Ana Ferrão;11912345678;Beta',
        'Luís Ávila;+55 11 3255-4210;Gama'
      ].join('\n')
    )

    const list = createContactList('Teste import')
    const preview = await buildPreview(file)

    expect(preview.encoding).toBe('latin1')
    expect(preview.delimiter).toBe(';')

    const mapping = guessMapping(preview.headers)
    // O palpite tem de acertar as colunas obvias.
    expect(mapping.phone).toBe('telefone')
    expect(mapping.name).toBe('nome')
    expect(mapping.extras).toContain('empresa')

    const report = await importCsv(list.id, preview, mapping)
    expect(report.imported).toBe(3)
    expect(report.invalidPhone).toBe(0)

    // Acentos intactos e telefone em E.164.
    expect(report.samples[0].name).toBe('João Conceição')
    expect(report.samples.map((s) => s.phoneE164)).toContain('+5511987654210')
  })

  it('conta invalidos, duplicados no arquivo e ja existentes na base', async () => {
    const list = createContactList('Teste duplicados')
    const file = writeExcelBrCsv(
      'dup.csv',
      [
        'nome;telefone',
        'Um;11987654210',
        'Dois;(11) 98765-4210', // mesmo numero, formatado diferente
        'Tres;nao tenho', // invalido
        'Quatro;123' // invalido
      ].join('\n')
    )

    const preview = await buildPreview(file)
    const r1 = await importCsv(list.id, preview, guessMapping(preview.headers))
    expect(r1.imported).toBe(1)
    expect(r1.duplicateInFile).toBe(1)
    expect(r1.invalidPhone).toBe(2)

    // Reimportar o mesmo arquivo nao duplica nada.
    const r2 = await importCsv(list.id, preview, guessMapping(preview.headers))
    expect(r2.imported).toBe(0)
    expect(r2.alreadyInList).toBe(1)
    expect(listStats(list.id).total).toBe(1)
  })

  it('ignora numeros com descadastro global', async () => {
    // Conformidade: quem pediu para sair nao volta por reimportacao de planilha.
    addOptOut('+5511900000001', 'teste')

    const list = createContactList('Teste opt-out')
    const file = writeExcelBrCsv(
      'optout.csv',
      ['nome;telefone', 'Bloqueado;11900000001', 'Livre;11900000002'].join('\n')
    )

    const preview = await buildPreview(file)
    const report = await importCsv(list.id, preview, guessMapping(preview.headers))

    expect(report.optedOut).toBe(1)
    expect(report.imported).toBe(1)
    expect(listStats(list.id).total).toBe(1)
  })

  it('exige a coluna de telefone', async () => {
    const list = createContactList('Teste sem telefone')
    const file = writeExcelBrCsv('semtel.csv', ['a;b', '1;2'].join('\n'))
    const preview = await buildPreview(file)
    await expect(importCsv(list.id, preview, { name: null, phone: null, extras: [] })).rejects.toThrow(
      /telefone/i
    )
  })
})
