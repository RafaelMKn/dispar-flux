import { useCallback, useEffect, useState } from 'react'
import {
  Trash2,
  Plus,
  Upload,
  Database,
  ArrowLeft,
  BadgeCheck,
  Search,
  ShieldOff,
  Loader2,
  FileDown,
  CheckCircle2
} from 'lucide-react'
import type { Contact, ContactFilter, ContactList, ContactListStats } from '@shared/types'
import {
  PageBody,
  PageHeader,
  Card,
  Button,
  IconButton,
  Input,
  EmptyState,
  Table,
  Th,
  Td,
  Pill,
  Progress,
  Callout
} from '../components/ui'
import CsvImportModal from '../components/CsvImportModal'
import { useWhatsapp } from '../useWhatsapp'

const PAGE_SIZE = 25

const FILTERS: { id: ContactFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'valid', label: 'Validos' },
  { id: 'invalid', label: 'Invalidos' },
  { id: 'unchecked', label: 'Nao verificados' },
  { id: 'optOut', label: 'Descadastrados' }
]

export default function BasePage(): JSX.Element {
  const wa = useWhatsapp()
  const [lists, setLists] = useState<ContactList[]>([])
  const [stats, setStats] = useState<Record<string, ContactListStats>>({})
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<ContactList | null>(null)
  const [templateMsg, setTemplateMsg] = useState<string | null>(null)

  async function handleTemplate(): Promise<void> {
    const caminho = await window.api.csv.saveTemplate()
    if (!caminho) return // usuario cancelou
    setTemplateMsg(`Modelo salvo em ${caminho}. Preencha no Excel e importe de volta.`)
    setTimeout(() => setTemplateMsg(null), 8000)
  }

  const refreshLists = useCallback(async () => {
    const rows = await window.api.contactLists.list()
    setLists(rows)
    const entries = await Promise.all(
      rows.map(async (l) => [l.id, await window.api.contactLists.stats(l.id)] as const)
    )
    setStats(Object.fromEntries(entries))
    setLoading(false)
  }, [])

  useEffect(() => {
    void refreshLists()
  }, [refreshLists])

  async function handleCreate(): Promise<void> {
    if (!name.trim()) return
    await window.api.contactLists.create(name)
    setName('')
    await refreshLists()
  }

  async function handleRemove(list: ContactList): Promise<void> {
    const s = stats[list.id]
    const aviso =
      s && s.total > 0
        ? `Excluir "${list.name}" e seus ${s.total} contatos? Isso nao pode ser desfeito.`
        : `Excluir "${list.name}"?`
    if (!window.confirm(aviso)) return
    await window.api.contactLists.remove(list.id)
    if (selected?.id === list.id) setSelected(null)
    await refreshLists()
  }

  if (selected) {
    return (
      <BaseDetail
        list={selected}
        stats={stats[selected.id]}
        connected={wa.status === 'connected'}
        onBack={() => {
          setSelected(null)
          void refreshLists()
        }}
        onChanged={refreshLists}
      />
    )
  }

  return (
    <PageBody>
      <PageHeader
        title="Base de Dados"
        subtitle="Cadastre suas bases de contatos e escolha qual delas recebe o disparo."
        aside={
          <Button variant="secondary" onClick={() => void handleTemplate()}>
            <FileDown size={16} /> Baixar modelo CSV
          </Button>
        }
      />

      {templateMsg && (
        <div className="mb-6">
          <Callout tone="success" icon={CheckCircle2}>
            {templateMsg}
          </Callout>
        </div>
      )}

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Input
              label="Nova base"
              placeholder="Ex.: Clientes 2026 — Sudeste"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>
          <Button onClick={handleCreate} disabled={!name.trim()}>
            <Plus size={16} /> Criar base
          </Button>
        </div>
      </Card>

      {loading ? (
        <p className="text-sm text-ink-tertiary">Carregando...</p>
      ) : lists.length === 0 ? (
        <EmptyState title="Nenhuma base ainda">
          Crie sua primeira base no campo acima. Depois voce podera importar um CSV e validar os
          numeros no WhatsApp.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {lists.map((list) => {
            const s = stats[list.id]
            return (
              <Card key={list.id} className="flex flex-wrap items-center gap-4">
                <Database size={18} className="flex-none text-accent-text" />
                <button
                  onClick={() => setSelected(list)}
                  className="min-w-0 flex-1 text-left"
                  title="Abrir base"
                >
                  <div className="text-base font-medium hover:text-accent-text">{list.name}</div>
                  <div className="tnum text-xs text-ink-meta">
                    {s
                      ? `${s.total} contatos · ${s.valid} validos · ${s.invalid} invalidos · ${s.unchecked} nao verificados · ${s.optOut} descadastrados`
                      : 'carregando...'}
                  </div>
                </button>
                <Button variant="secondary" onClick={() => setSelected(list)}>
                  Abrir
                </Button>
                <IconButton
                  label={`Excluir base ${list.name}`}
                  onClick={() => handleRemove(list)}
                  className="text-state-dangerText hover:bg-state-dangerWash"
                >
                  <Trash2 size={16} />
                </IconButton>
              </Card>
            )
          })}
        </div>
      )}
    </PageBody>
  )
}

/* ── Detalhe de uma base ────────────────────────────────────────────────── */

function BaseDetail({
  list,
  stats,
  connected,
  onBack,
  onChanged
}: {
  list: ContactList
  stats?: ContactListStats
  connected: boolean
  onBack: () => void
  onChanged: () => Promise<void>
}): JSX.Element {
  const [rows, setRows] = useState<Contact[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ContactFilter>('all')
  const [showImport, setShowImport] = useState(false)
  const [validating, setValidating] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [localStats, setLocalStats] = useState<ContactListStats | undefined>(stats)
  const [extras, setExtras] = useState<string[]>([])
  const [showExtras, setShowExtras] = useState(true)

  const load = useCallback(async () => {
    const res = await window.api.contacts.page(list.id, {
      search,
      filter,
      offset: page * PAGE_SIZE,
      limit: PAGE_SIZE
    })
    setRows(res.rows)
    setTotal(res.total)
    setLocalStats(await window.api.contactLists.stats(list.id))
    setExtras(await window.api.contacts.extraKeys(list.id))
  }, [list.id, search, filter, page])

  /** Campos extras do contato, vindos do CSV importado. */
  function parseExtras(extraJson: string | null): Record<string, string> {
    if (!extraJson) return {}
    try {
      return JSON.parse(extraJson) as Record<string, string>
    } catch {
      return {}
    }
  }

  useEffect(() => {
    void load()
  }, [load])

  // Progresso da validacao vem por evento do main.
  useEffect(() => {
    return window.api.contacts.onValidateProgress((p) => {
      if (p.listId === list.id) setProgress({ done: p.done, total: p.total })
    })
  }, [list.id])

  async function handleValidate(): Promise<void> {
    setError(null)
    setValidating(true)
    setProgress({ done: 0, total: localStats?.unchecked ?? 0 })
    try {
      await window.api.contacts.validate(list.id)
      await load()
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao validar.')
    } finally {
      setValidating(false)
      setProgress(null)
    }
  }

  async function handleExport(): Promise<void> {
    setError(null)
    try {
      await window.api.csv.exportList(list.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao exportar.')
    }
  }

  async function toggleOptOut(c: Contact): Promise<void> {
    await window.api.contacts.setOptOut(c.id, c.optOut !== 1)
    await load()
    await onChanged()
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <PageBody>
      <div className="mb-6 flex flex-wrap items-start gap-4">
        <IconButton label="Voltar para as bases" onClick={onBack}>
          <ArrowLeft size={16} />
        </IconButton>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-[-.01em]">{list.name}</h1>
          <p className="tnum mt-1 text-sm text-ink-secondary">
            {localStats
              ? `${localStats.total} contatos · ${localStats.valid} validos · ${localStats.invalid} invalidos · ${localStats.unchecked} nao verificados · ${localStats.optOut} descadastrados`
              : ''}
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setShowImport(true)}>
            <Upload size={16} /> Importar CSV
          </Button>
          <Button
            onClick={handleValidate}
            disabled={validating || !connected || (localStats?.unchecked ?? 0) === 0}
            title={
              !connected
                ? 'Conecte o WhatsApp em Configuracoes'
                : (localStats?.unchecked ?? 0) === 0
                  ? 'Nenhum contato pendente de verificacao'
                  : undefined
            }
          >
            {validating ? (
              <Loader2 size={16} className="animate-[dfspin_1s_linear_infinite]" />
            ) : (
              <BadgeCheck size={16} />
            )}
            Validar no WhatsApp
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <Callout tone="danger">{error}</Callout>
        </div>
      )}

      {validating && progress && (
        <Card className="mb-4">
          <div className="tnum mb-2 flex items-center justify-between text-xs text-ink-secondary">
            <span>
              Verificando {progress.done} de {progress.total}
            </span>
            <span>Em lotes, com pausa — checagem em massa e sinal de spam para o WhatsApp.</span>
          </div>
          <Progress value={progress.done} max={progress.total} />
        </Card>
      )}

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-[220px] flex-1 items-center gap-2 rounded border border-line bg-surface-base px-3 py-2">
            <Search size={16} className="flex-none text-ink-tertiary" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(0)
              }}
              placeholder="Buscar por nome ou telefone"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-tertiary"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => {
                  setFilter(f.id)
                  setPage(0)
                }}
                className={[
                  'rounded-full border px-3 py-1 text-xs transition-colors duration-120',
                  filter === f.id
                    ? 'border-accent bg-accent-wash text-accent-text'
                    : 'border-line text-ink-secondary hover:bg-accent-wash'
                ].join(' ')}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {(extras.length > 0 || total > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line-subtle pt-3">
            {extras.length > 0 && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-secondary">
                <input
                  type="checkbox"
                  checked={showExtras}
                  onChange={(e) => setShowExtras(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Mostrar colunas do CSV ({extras.join(', ')})
              </label>
            )}
            <div className="flex-1" />
            <Button variant="secondary" onClick={() => void handleExport()} disabled={total === 0}>
              <FileDown size={16} /> Exportar CSV
            </Button>
          </div>
        )}
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="Nenhum contato aqui">
          {total === 0 && !search && filter === 'all'
            ? 'Importe um CSV para popular esta base.'
            : 'Nenhum contato corresponde a esse filtro ou busca.'}
        </EmptyState>
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Telefone</Th>
                <Th>WhatsApp</Th>
                {showExtras && extras.map((k) => <Th key={k}>{k}</Th>)}
                <Th className="text-right">Acoes</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const ex = parseExtras(c.extraJson)
                return (
                  <tr key={c.id} className={c.optOut === 1 ? 'opacity-60' : undefined}>
                    <Td className="max-w-[260px] truncate">
                      {c.name || <span className="text-ink-tertiary">(sem nome)</span>}
                    </Td>
                    <Td className="tnum whitespace-nowrap">{c.phoneE164}</Td>
                    <Td className="whitespace-nowrap">
                      {c.optOut === 1 ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-state-warningText">
                          <ShieldOff size={13} /> descadastrado
                        </span>
                      ) : c.waValid === 1 ? (
                        <span className="text-xs text-state-successText">valido</span>
                      ) : c.waValid === 0 ? (
                        <span className="text-xs text-state-dangerText">nao existe</span>
                      ) : (
                        <span className="text-xs text-ink-tertiary">nao verificado</span>
                      )}
                    </Td>
                    {showExtras &&
                      extras.map((k) => (
                        <Td key={k} className="max-w-[200px] truncate text-ink-secondary">
                          {ex[k] ?? ''}
                        </Td>
                      ))}
                    <Td className="text-right">
                      <button
                        onClick={() => void toggleOptOut(c)}
                        className="whitespace-nowrap rounded px-2 py-1 text-xs text-ink-secondary hover:bg-accent-wash"
                        title={
                          c.optOut === 1
                            ? 'Remover o descadastro (vale para todas as bases)'
                            : 'Marcar descadastro (vale para todas as bases)'
                        }
                      >
                        {c.optOut === 1 ? 'Reativar' : 'Descadastrar'}
                      </button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </Table>

          <p className="tnum mt-3 text-xs text-ink-tertiary">
            Mostrando {rows.length} de {total} contato(s)
            {extras.length > 0 && ` · ${extras.length} coluna(s) extra(s) do CSV`}
          </p>

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <Button
                variant="secondary"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Anterior
              </Button>
              <Pill>
                <span className="tnum">
                  {page + 1} de {pages}
                </span>
              </Pill>
              <Button
                variant="secondary"
                onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}
                disabled={page >= pages - 1}
              >
                Proxima
              </Button>
            </div>
          )}
        </>
      )}

      {showImport && (
        <CsvImportModal
          listId={list.id}
          onClose={() => setShowImport(false)}
          onImported={() => {
            void load()
            void onChanged()
          }}
        />
      )}
    </PageBody>
  )
}
