import { useState } from 'react'
import { FileUp, CheckCircle2, AlertTriangle, FileDown } from 'lucide-react'
import type { CsvPreview, CsvMapping, ImportReport } from '@shared/types'
import { Modal, Button, Callout, Table, Th, Td } from './ui'

type Step = 'pick' | 'map' | 'done'

const selectCls =
  'w-full rounded border border-line bg-surface-raised px-2.5 py-1.5 text-sm text-ink outline-none focus-visible:border-accent-strong'

export default function CsvImportModal({
  listId,
  onClose,
  onImported
}: {
  listId: string
  onClose: () => void
  onImported: () => void
}): JSX.Element {
  const [step, setStep] = useState<Step>('pick')
  const [preview, setPreview] = useState<CsvPreview | null>(null)
  const [mapping, setMapping] = useState<CsvMapping>({ name: null, phone: null, extras: [] })
  const [report, setReport] = useState<ImportReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pick(): Promise<void> {
    setError(null)
    setBusy(true)
    try {
      const p = await window.api.csv.pick()
      if (!p) return // usuario cancelou
      if (p.headers.length === 0) {
        setError('O arquivo parece vazio ou nao tem cabecalho.')
        return
      }
      setPreview(p)
      setMapping(p.suggested ?? { name: null, phone: null, extras: [] })
      setStep('map')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao ler o arquivo.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm(): Promise<void> {
    if (!preview || !mapping.phone) return
    setError(null)
    setBusy(true)
    try {
      const r = await window.api.csv.import(listId, preview, mapping)
      setReport(r)
      setStep('done')
      onImported()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao importar.')
    } finally {
      setBusy(false)
    }
  }

  function toggleExtra(header: string): void {
    setMapping((m) => ({
      ...m,
      extras: m.extras.includes(header)
        ? m.extras.filter((h) => h !== header)
        : [...m.extras, header]
    }))
  }

  const title =
    step === 'pick' ? 'Importar CSV' : step === 'map' ? 'Mapear colunas' : 'Importacao concluida'

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide={step !== 'pick'}
      footer={
        step === 'pick' ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={pick} disabled={busy}>
              <FileUp size={16} /> Escolher arquivo
            </Button>
          </>
        ) : step === 'map' ? (
          <>
            <Button variant="secondary" onClick={() => setStep('pick')} disabled={busy}>
              Voltar
            </Button>
            <Button onClick={confirm} disabled={busy || !mapping.phone}>
              {busy ? 'Importando...' : 'Importar contatos'}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Fechar</Button>
        )
      }
    >
      {error && (
        <div className="mb-4">
          <Callout tone="danger" icon={AlertTriangle}>
            {error}
          </Callout>
        </div>
      )}

      {step === 'pick' && (
        <div className="space-y-4">
          <p className="text-sm text-ink-secondary [text-wrap:pretty]">
            Escolha um arquivo <strong>.csv</strong>. O app detecta sozinho o separador
            (<code>,</code> ou <code>;</code>) e a codificacao — inclusive arquivos exportados do
            Excel em portugues, que costumam vir em latin1 e quebrariam os acentos.
          </p>
          <Callout tone="neutral" icon={FileUp}>
            Importe apenas contatos que autorizaram receber suas mensagens. Numeros com
            descadastro registrado sao ignorados automaticamente.
          </Callout>

          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-secondary">Nao tem uma planilha pronta?</span>
            <button
              onClick={() => void window.api.csv.saveTemplate()}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-accent-text hover:bg-accent-wash"
            >
              <FileDown size={15} /> Baixar modelo
            </button>
          </div>
        </div>
      )}

      {step === 'map' && preview && (
        <div className="space-y-5">
          <div className="tnum flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-meta">
            <span>
              Linhas: <strong className="text-ink">{preview.totalRows}</strong>
            </span>
            <span>
              Separador: <strong className="text-ink">{preview.delimiter === ';' ? 'ponto e virgula' : preview.delimiter === ',' ? 'virgula' : preview.delimiter}</strong>
            </span>
            <span>
              Codificacao: <strong className="text-ink">{preview.encoding}</strong>
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs text-ink-secondary">
                Coluna do telefone <span className="text-state-dangerText">*</span>
              </span>
              <select
                className={selectCls}
                value={mapping.phone ?? ''}
                onChange={(e) => setMapping({ ...mapping, phone: e.target.value || null })}
              >
                <option value="">Selecione...</option>
                {preview.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs text-ink-secondary">Coluna do nome</span>
              <select
                className={selectCls}
                value={mapping.name ?? ''}
                onChange={(e) => setMapping({ ...mapping, name: e.target.value || null })}
              >
                <option value="">(sem nome)</option>
                {preview.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <span className="mb-2 block text-xs text-ink-secondary">
              Campos extras (ficam disponiveis como variaveis na mensagem)
            </span>
            <div className="flex flex-wrap gap-2">
              {preview.headers
                .filter((h) => h !== mapping.phone && h !== mapping.name)
                .map((h) => {
                  const on = mapping.extras.includes(h)
                  return (
                    <button
                      key={h}
                      onClick={() => toggleExtra(h)}
                      className={[
                        'rounded-full border px-3 py-1 text-xs transition-colors duration-120',
                        on
                          ? 'border-accent bg-accent-wash text-accent-text'
                          : 'border-line text-ink-secondary hover:bg-accent-wash'
                      ].join(' ')}
                    >
                      {h}
                    </button>
                  )
                })}
            </div>
          </div>

          <div>
            <span className="mb-2 block text-xs text-ink-secondary">
              Primeiras linhas do arquivo
            </span>
            <Table>
              <thead>
                <tr>
                  {preview.headers.map((h) => (
                    <Th key={h}>
                      {h}
                      {h === mapping.phone && <span className="text-accent-text"> (telefone)</span>}
                      {h === mapping.name && <span className="text-accent-text"> (nome)</span>}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, i) => (
                  <tr key={i}>
                    {preview.headers.map((_h, j) => (
                      <Td key={j} className="whitespace-nowrap text-ink-secondary">
                        {row[j] ?? ''}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      )}

      {step === 'done' && report && (
        <div className="space-y-4">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={20} className="flex-none text-state-successText" />
            <p className="text-base font-medium">
              <span className="tnum">{report.imported}</span>{' '}
              {report.imported === 1 ? 'contato importado' : 'contatos importados'}
            </p>
          </div>

          <Table>
            <tbody>
              {[
                ['Importados', report.imported],
                ['Telefone invalido', report.invalidPhone],
                ['Duplicados no arquivo', report.duplicateInFile],
                ['Ja existiam na base', report.alreadyInList],
                ['Com descadastro (ignorados)', report.optedOut]
              ].map(([label, n]) => (
                <tr key={String(label)}>
                  <Td className="text-ink-secondary">{label}</Td>
                  <Td className="tnum w-24 text-right font-medium">{n}</Td>
                </tr>
              ))}
            </tbody>
          </Table>

          {report.imported > 0 && (
            <Callout tone="neutral" icon={CheckCircle2}>
              Proximo passo: use <strong>Validar no WhatsApp</strong> para descobrir quais numeros
              existem de fato. Isso evita gastar envios com numeros invalidos.
            </Callout>
          )}
        </div>
      )}
    </Modal>
  )
}
