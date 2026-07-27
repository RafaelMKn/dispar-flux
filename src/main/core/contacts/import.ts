import { readFile } from 'node:fs/promises'
import { decodeCsvBuffer, parseCsv, cell } from './csv'
import { normalizePhone } from './phone'
import {
  insertContacts,
  existingPhones,
  extraKeys,
  pageContacts,
  type NewContact
} from '../../repos/contacts'
import { getOptOutSet } from '../../repos/optOuts'
import { toCsvBuffer } from './template'
import type { CsvPreview, CsvMapping, ImportReport } from '@shared/types'

const PREVIEW_ROWS = 8

/** Le o arquivo e devolve headers + primeiras linhas para o usuario mapear. */
export async function buildPreview(filePath: string): Promise<CsvPreview> {
  const buf = await readFile(filePath)
  const { text, encoding } = decodeCsvBuffer(buf)
  const { headers, rows, delimiter } = parseCsv(text)
  return {
    filePath,
    encoding,
    delimiter,
    headers,
    rows: rows.slice(0, PREVIEW_ROWS),
    totalRows: rows.length
  }
}

/** Sugere o mapeamento olhando os nomes das colunas (acerta a maioria dos CSVs). */
export function guessMapping(headers: string[]): CsvMapping {
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')

  const findBy = (candidates: string[]): string | null =>
    headers.find((h) => candidates.some((c) => norm(h).includes(c))) ?? null

  const phone = findBy(['telefone', 'celular', 'whatsapp', 'fone', 'phone', 'numero', 'tel'])
  const name = findBy(['nome', 'name', 'contato', 'cliente', 'razao'])

  return {
    name,
    phone,
    extras: headers.filter((h) => h !== name && h !== phone)
  }
}

/**
 * Importa os contatos aplicando o mapeamento.
 *
 * Descarta, contabilizando: telefone invalido, duplicado dentro do arquivo,
 * numero que ja existe na base e numero com opt-out global (nao faz sentido
 * importar quem pediu para nao ser contatado).
 */
export async function importCsv(
  listId: string,
  preview: CsvPreview,
  mapping: CsvMapping
): Promise<ImportReport> {
  if (!mapping.phone) throw new Error('Selecione qual coluna contem o telefone.')

  const buf = await readFile(preview.filePath)
  const { text } = decodeCsvBuffer(buf)
  const { headers, rows } = parseCsv(text)

  const already = existingPhones(listId)
  const seen = new Set<string>()
  const report: ImportReport = {
    imported: 0,
    invalidPhone: 0,
    duplicateInFile: 0,
    alreadyInList: 0,
    optedOut: 0,
    samples: []
  }

  const candidates: { name: string | null; phoneE164: string; extraJson: string | null }[] = []

  for (const row of rows) {
    const rawPhone = cell(headers, row, mapping.phone)
    const phoneE164 = normalizePhone(rawPhone)
    if (!phoneE164) {
      report.invalidPhone += 1
      continue
    }
    if (seen.has(phoneE164)) {
      report.duplicateInFile += 1
      continue
    }
    seen.add(phoneE164)
    if (already.has(phoneE164)) {
      report.alreadyInList += 1
      continue
    }

    const rawName = cell(headers, row, mapping.name)
    const extras: Record<string, string> = {}
    for (const h of mapping.extras) {
      const v = cell(headers, row, h)
      if (v) extras[h] = v
    }

    candidates.push({
      name: rawName || null,
      phoneE164,
      extraJson: Object.keys(extras).length > 0 ? JSON.stringify(extras) : null
    })
  }

  // Filtra opt-outs globais numa consulta so.
  const optedOut = getOptOutSet(candidates.map((c) => c.phoneE164))
  const toInsert: NewContact[] = []
  for (const c of candidates) {
    if (optedOut.has(c.phoneE164)) {
      report.optedOut += 1
      continue
    }
    toInsert.push({ listId, ...c })
  }

  report.imported = insertContacts(toInsert)
  report.samples = toInsert.slice(0, 3).map((c) => ({ name: c.name, phoneE164: c.phoneE164 }))
  return report
}

/**
 * Exporta a base como CSV, no mesmo formato do modelo — o arquivo exportado
 * pode ser editado no Excel e reimportado sem ajuste.
 */
export function buildExportCsv(listId: string): Buffer {
  const extras = extraKeys(listId)
  const headers = ['nome', 'telefone', 'whatsapp', 'descadastrado', ...extras]

  const { rows } = pageContacts(listId, { limit: 100_000 })
  const linhas = rows.map((c) => {
    let extrasObj: Record<string, string> = {}
    try {
      extrasObj = c.extraJson ? (JSON.parse(c.extraJson) as Record<string, string>) : {}
    } catch {
      extrasObj = {}
    }
    const wa = c.waValid === 1 ? 'valido' : c.waValid === 0 ? 'nao existe' : 'nao verificado'
    return [
      c.name ?? '',
      c.phoneE164,
      wa,
      c.optOut === 1 ? 'sim' : 'nao',
      ...extras.map((k) => String(extrasObj[k] ?? ''))
    ]
  })

  return toCsvBuffer(headers, linhas)
}
