import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Type,
  Layers,
  Shuffle,
  Sparkles,
  Database,
  Plus,
  Trash2,
  Play,
  Pause,
  Square,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  type LucideIcon
} from 'lucide-react'
import type {
  MessageMode,
  MessageConfig,
  ContactList,
  ContactListStats,
  SendingDefaults,
  CampaignPlan,
  CampaignProgress,
  CampaignJobView,
  JobStatus
} from '@shared/types'
import { countCombinations, poolSizes } from '@shared/messages'
import {
  PageBody,
  PageHeader,
  StepSection,
  Card,
  Button,
  IconButton,
  Input,
  Callout,
  Pill,
  StatusDot,
  Progress,
  EmptyState,
  Table,
  Th,
  Td,
  Select
} from '../components/ui'
import { useWhatsapp } from '../useWhatsapp'

interface ModeCard {
  id: MessageMode
  label: string
  icon: LucideIcon
  desc: string
  disabled?: string
}

const MODES: ModeCard[] = [
  { id: 'fixed', label: 'Fixa', icon: Type, desc: 'Um texto unico, com variaveis do contato.' },
  {
    id: 'rotate',
    label: 'Alternada',
    icon: Layers,
    desc: 'Varias mensagens completas em rodizio.'
  },
  {
    id: 'paragraph',
    label: 'Alternada por paragrafo',
    icon: Shuffle,
    desc: 'Sorteia uma variacao de cada paragrafo.'
  },
  {
    id: 'ai',
    label: 'IA',
    icon: Sparkles,
    desc: 'A IA escreve cada mensagem conforme seu prompt.',
    disabled: 'Fase 3'
  }
]

const JOB_LABEL: Record<JobStatus, string> = {
  pending: 'Na fila',
  sending: 'Enviando',
  sent: 'Enviado',
  failed: 'Falhou',
  skipped: 'Pulado',
  unknown: 'Indeterminado'
}

const JOB_TONE: Record<JobStatus, 'success' | 'warning' | 'danger' | 'idle'> = {
  pending: 'idle',
  sending: 'idle',
  sent: 'success',
  failed: 'danger',
  skipped: 'warning',
  unknown: 'warning'
}

const textareaCls =
  'w-full rounded border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-tertiary focus-visible:border-accent-strong'

export default function DisparoPage(): JSX.Element {
  const wa = useWhatsapp()
  const [lists, setLists] = useState<ContactList[]>([])
  const [stats, setStats] = useState<Record<string, ContactListStats>>({})
  const [listId, setListId] = useState<string>('')
  const [mode, setMode] = useState<MessageMode>('fixed')
  const [name, setName] = useState('')
  const [config, setConfig] = useState<MessageConfig>({
    text: '',
    messages: [''],
    pools: [[''], [''], ['']]
  })
  const [pacing, setPacing] = useState<SendingDefaults | null>(null)
  const [skipAlreadySent, setSkipAlreadySent] = useState(false)
  const [plan, setPlan] = useState<CampaignPlan | null>(null)
  const [progress, setProgress] = useState<CampaignProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [jobsOpen, setJobsOpen] = useState(false)
  const [jobsFilter, setJobsFilter] = useState<JobStatus | 'all'>('all')
  const [jobsView, setJobsView] = useState<{ rows: CampaignJobView[]; total: number } | null>(null)
  const [jobsLoading, setJobsLoading] = useState(false)
  // So comeca a persistir o rascunho depois de restaurar o que ja existia,
  // senao o primeiro render (com os defaults vazios) sobrescreveria o salvo.
  const draftReady = useRef(false)

  useEffect(() => {
    void (async () => {
      const rows = await window.api.contactLists.list()
      setLists(rows)
      const entries = await Promise.all(
        rows.map(async (l) => [l.id, await window.api.contactLists.stats(l.id)] as const)
      )
      setStats(Object.fromEntries(entries))
      const defaults = await window.api.settings.getSendingDefaults()
      setProgress(await window.api.campaign.active())

      const draft = await window.api.campaign.loadDraft()
      if (draft) {
        setListId(draft.listId)
        setMode(draft.mode)
        setName(draft.name)
        setConfig(draft.config)
        setPacing(draft.pacing ?? defaults)
      } else {
        setPacing(defaults)
      }
      draftReady.current = true
    })()
  }, [])

  // Salva o rascunho a cada mudanca (com debounce) para sobreviver a troca de
  // aba e ao fechamento do app — antes disso o estado so existia em memoria.
  useEffect(() => {
    if (!draftReady.current) return
    const t = setTimeout(() => {
      void window.api.campaign.saveDraft({ listId, mode, name, config, pacing })
    }, 400)
    return () => clearTimeout(t)
  }, [listId, mode, name, config, pacing])

  // Progresso e parada chegam por evento do main.
  useEffect(() => {
    const offP = window.api.campaign.onProgress(setProgress)
    const offS = window.api.campaign.onStopped(({ reason }) => {
      if (reason === 'dailyCap') setError('Teto diario atingido. A fila continua para amanha.')
      if (reason === 'disconnected') setError('O WhatsApp desconectou. A campanha ficou pausada.')
    })
    return () => {
      offP()
      offS()
    }
  }, [])

  const campaignId = progress?.campaignId ?? null

  const loadJobs = useCallback(async () => {
    if (!campaignId) return
    setJobsLoading(true)
    try {
      setJobsView(
        await window.api.campaign.jobs(
          campaignId,
          jobsFilter === 'all' ? undefined : { status: jobsFilter }
        )
      )
    } finally {
      setJobsLoading(false)
    }
  }, [campaignId, jobsFilter])

  // Carrega ao abrir o painel e ao trocar o filtro.
  useEffect(() => {
    if (jobsOpen) void loadJobs()
  }, [jobsOpen, loadJobs])

  // Atualiza sozinho enquanto o painel esta aberto e o disparo avanca — e a
  // parte "dinamica": sem isso, a lista so mudaria se o usuario reabrisse.
  useEffect(() => {
    if (!jobsOpen || !progress) return
    void loadJobs()
    // Dispara so quando os contadores mudam, nao a cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.sent, progress?.failed, progress?.skipped, progress?.unknown, progress?.pending])

  const refreshPlan = useCallback(async () => {
    if (!listId || mode === 'ai') {
      setPlan(null)
      return
    }
    try {
      setPlan(await window.api.campaign.plan(listId, mode, config, skipAlreadySent))
    } catch {
      setPlan(null)
    }
  }, [listId, mode, config, skipAlreadySent])

  useEffect(() => {
    void refreshPlan()
  }, [refreshPlan])

  const running = progress && (progress.status === 'running' || progress.pending > 0)

  async function handleStart(): Promise<void> {
    if (!listId || !pacing) return
    setError(null)
    setBusy(true)
    try {
      const r = await window.api.campaign.start({
        name: name.trim() || `Campanha ${new Date().toLocaleDateString('pt-BR')}`,
        listId,
        mode,
        config,
        pacing,
        skipAlreadySent
      })
      setProgress(await window.api.campaign.progress(r.campaignId))
      // A campanha ja foi criada e enfileirada no banco; o rascunho nao serve mais.
      void window.api.campaign.saveDraft(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao iniciar a campanha.')
    } finally {
      setBusy(false)
    }
  }

  const combos = countCombinations(config.pools ?? [])
  const selectedStats = listId ? stats[listId] : undefined
  const canStart =
    Boolean(listId) &&
    wa.status === 'connected' &&
    mode !== 'ai' &&
    (plan?.eligible ?? 0) > 0 &&
    !busy &&
    !running

  return (
    <PageBody>
      <PageHeader
        title="Disparo"
        subtitle="Configure a campanha e envie no seu ritmo. Voce pode pausar a qualquer momento."
        aside={
          <Pill>
            <StatusDot tone={wa.status === 'connected' ? 'success' : 'idle'} />
            {wa.status === 'connected' ? 'Numero conectado' : 'Nenhum numero conectado'}
          </Pill>
        }
      />

      <div className="mb-8">
        <Callout>
          Envie apenas para contatos que autorizaram receber suas mensagens. Disparos em massa
          violam os Termos do WhatsApp e podem banir o numero; dados pessoais seguem a LGPD.
        </Callout>
      </div>

      {error && (
        <div className="mb-6">
          <Callout tone="danger">{error}</Callout>
        </div>
      )}

      {/* Execucao em andamento, retomavel, ou o ultimo disparo desta sessao */}
      {progress && (
        <Card className="mb-8">
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-base font-semibold">
              {progress.status === 'running'
                ? 'Disparo em andamento'
                : progress.status === 'paused'
                  ? 'Disparo pausado'
                  : progress.status === 'canceled'
                    ? 'Disparo cancelado'
                    : 'Ultimo disparo'}
            </h2>
            <div className="flex-1" />
            {running && (
              <>
                {progress.status === 'running' ? (
                  <Button variant="secondary" onClick={() => void window.api.campaign.pause()}>
                    <Pause size={16} /> Pausar
                  </Button>
                ) : (
                  <Button
                    onClick={() => void window.api.campaign.resume(progress.campaignId)}
                    disabled={wa.status !== 'connected'}
                  >
                    <Play size={16} /> Retomar
                  </Button>
                )}
                <Button variant="danger" onClick={() => void window.api.campaign.cancel()}>
                  <Square size={16} /> Cancelar
                </Button>
              </>
            )}
          </div>

          <Progress
            value={progress.sent + progress.failed + progress.skipped}
            max={progress.total}
          />

          <div className="tnum mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <span className="text-state-successText">{progress.sent} enviados</span>
            <span className="text-ink-meta">{progress.pending} na fila</span>
            {progress.skipped > 0 && (
              <span className="text-state-warningText">{progress.skipped} pulados</span>
            )}
            {progress.failed > 0 && (
              <span className="text-state-dangerText">{progress.failed} falharam</span>
            )}
            {progress.unknown > 0 && (
              <span className="text-state-warningText">{progress.unknown} indeterminados</span>
            )}
          </div>

          {progress.unknown > 0 && (
            <div className="mt-4">
              <Callout tone="warning">
                <strong>{progress.unknown}</strong> mensagem(ns) ficaram com entrega indeterminada
                porque o app foi encerrado durante o envio. Nao reenviamos automaticamente — pode
                ter chegado, e mandar de novo aumenta o risco de denuncia.
              </Callout>
            </div>
          )}

          <div className="mt-4 border-t border-line pt-4">
            <button
              onClick={() => setJobsOpen((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium text-accent-text"
            >
              {jobsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {jobsOpen ? 'Ocultar detalhes por contato' : 'Ver detalhes por contato'}
            </button>

            {jobsOpen && (
              <div className="mt-3">
                <div className="mb-3 flex flex-wrap items-center gap-3">
                  <Select
                    className="w-auto"
                    value={jobsFilter}
                    onChange={(e) => setJobsFilter(e.target.value as JobStatus | 'all')}
                  >
                    <option value="all">Todos</option>
                    <option value="sent">Enviados</option>
                    <option value="pending">Na fila</option>
                    <option value="sending">Enviando</option>
                    <option value="failed">Falharam</option>
                    <option value="skipped">Pulados</option>
                    <option value="unknown">Indeterminados</option>
                  </Select>
                  <div className="flex-1" />
                  <IconButton label="Atualizar" onClick={() => void loadJobs()}>
                    <RefreshCw size={14} />
                  </IconButton>
                </div>

                {jobsLoading && !jobsView ? (
                  <p className="text-sm text-ink-meta">Carregando...</p>
                ) : jobsView && jobsView.rows.length > 0 ? (
                  <>
                    <div className="max-h-96 overflow-y-auto">
                      <Table>
                        <thead>
                          <tr>
                            <Th>Contato</Th>
                            <Th>Status</Th>
                            <Th>Detalhe</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {jobsView.rows.map((j) => (
                            <tr key={j.id}>
                              <Td>
                                <div className="font-medium">{j.contactName || j.phoneE164}</div>
                                {j.contactName && (
                                  <div className="text-xs text-ink-meta">{j.phoneE164}</div>
                                )}
                              </Td>
                              <Td>
                                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                  <StatusDot tone={JOB_TONE[j.status]} />
                                  {JOB_LABEL[j.status]}
                                </span>
                              </Td>
                              <Td className="text-xs text-ink-meta">
                                {j.status === 'sent' && j.sentAt
                                  ? new Date(j.sentAt).toLocaleString('pt-BR')
                                  : (j.error ?? '')}
                              </Td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </div>
                    {jobsView.total > jobsView.rows.length && (
                      <p className="mt-2 text-xs text-ink-tertiary">
                        Mostrando {jobsView.rows.length} de {jobsView.total}. Use o filtro de status
                        para refinar.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-ink-meta">Nenhum contato neste filtro.</p>
                )}
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-8">
        <StepSection
          step={1}
          title="Base de destino"
          hint="So contatos validos e sem opt-out entram no disparo."
        >
          {lists.length === 0 ? (
            <EmptyState title="Nenhuma base cadastrada">
              Crie uma base e importe seus contatos em <strong>Base de Dados</strong>.
            </EmptyState>
          ) : (
            <div className="flex flex-col gap-2">
              {lists.map((l) => {
                const s = stats[l.id]
                const on = listId === l.id
                return (
                  <button
                    key={l.id}
                    onClick={() => setListId(l.id)}
                    className={[
                      'flex flex-wrap items-center gap-4 rounded-lg border p-4 text-left transition-colors',
                      on
                        ? 'border-accent bg-accent-wash'
                        : 'border-line bg-surface-raised hover:bg-accent-wash'
                    ].join(' ')}
                  >
                    <Database size={18} className="flex-none text-accent-text" />
                    <div className="min-w-0 flex-1">
                      <div className="text-base font-medium">{l.name}</div>
                      <div className="tnum text-xs text-ink-meta">
                        {s
                          ? `${s.valid} validos · ${s.unchecked} nao verificados · ${s.optOut} descadastrados`
                          : ''}
                      </div>
                    </div>
                    <span
                      className={[
                        'h-3.5 w-3.5 flex-none rounded-full bg-surface-base',
                        on ? 'border-4 border-accent' : 'border-[1.5px] border-line'
                      ].join(' ')}
                    />
                  </button>
                )
              })}
            </div>
          )}

          {selectedStats && selectedStats.unchecked > 0 && (
            <div className="mt-3">
              <Callout tone="warning">
                <strong>{selectedStats.unchecked}</strong> contato(s) ainda nao foram validados no
                WhatsApp e ficarao de fora. Valide em <strong>Base de Dados</strong> para incluir.
              </Callout>
            </div>
          )}
        </StepSection>

        <StepSection
          step={2}
          title="Modo de mensagem"
          hint="Variar o texto reduz o risco de o numero ser sinalizado."
        >
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(228px,1fr))]">
            {MODES.map((m) => {
              const on = mode === m.id
              const off = Boolean(m.disabled)
              return (
                <button
                  key={m.id}
                  onClick={() => !off && setMode(m.id)}
                  disabled={off}
                  aria-pressed={on}
                  className={[
                    'flex flex-col items-start gap-1.5 rounded-lg border p-3.5 text-left transition-colors',
                    off
                      ? 'cursor-not-allowed border-line bg-surface-raised opacity-50'
                      : on
                        ? 'cursor-pointer border-accent bg-accent-wash'
                        : 'cursor-pointer border-line bg-surface-raised hover:bg-accent-wash'
                  ].join(' ')}
                >
                  <div className="flex w-full items-center gap-2.5">
                    <m.icon size={18} className="flex-none" />
                    <span className="text-base font-medium">{m.label}</span>
                    <span className="flex-1" />
                    {m.disabled ? (
                      <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] text-ink-meta">
                        {m.disabled}
                      </span>
                    ) : (
                      <span
                        className={[
                          'h-3.5 w-3.5 flex-none rounded-full bg-surface-base',
                          on ? 'border-4 border-accent' : 'border-[1.5px] border-line'
                        ].join(' ')}
                      />
                    )}
                  </div>
                  <span className="text-xs text-ink-meta [text-wrap:pretty]">{m.desc}</span>
                </button>
              )
            })}
          </div>
        </StepSection>

        <StepSection
          step={3}
          title="Conteudo"
          hint="Use [nome] para personalizar. Se o contato nao tiver nome, o app limpa a frase sozinho."
        >
          {mode === 'fixed' && (
            <Card>
              <textarea
                rows={6}
                className={textareaCls}
                placeholder="Oi [nome], tudo bem? Aqui e a Marina da Cortez Moveis..."
                value={config.text ?? ''}
                onChange={(e) => setConfig({ ...config, text: e.target.value })}
              />
              <p className="mt-2 text-xs text-ink-tertiary">
                Variaveis: <code>[nome]</code>, os campos extras do CSV, e fallback com{' '}
                <code>[nome|cliente]</code>.
              </p>
            </Card>
          )}

          {mode === 'rotate' && (
            <div className="flex flex-col gap-2">
              {(config.messages ?? ['']).map((msg, i) => (
                <Card key={i}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-medium text-ink-secondary">Mensagem {i + 1}</span>
                    <div className="flex-1" />
                    {(config.messages?.length ?? 0) > 1 && (
                      <IconButton
                        label={`Remover mensagem ${i + 1}`}
                        onClick={() =>
                          setConfig({
                            ...config,
                            messages: (config.messages ?? []).filter((_, j) => j !== i)
                          })
                        }
                        className="text-state-dangerText hover:bg-state-dangerWash"
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    )}
                  </div>
                  <textarea
                    rows={3}
                    className={textareaCls}
                    placeholder={`Variacao ${i + 1} da mensagem`}
                    value={msg}
                    onChange={(e) => {
                      const next = [...(config.messages ?? [])]
                      next[i] = e.target.value
                      setConfig({ ...config, messages: next })
                    }}
                  />
                </Card>
              ))}
              <Button
                variant="secondary"
                onClick={() => setConfig({ ...config, messages: [...(config.messages ?? []), ''] })}
              >
                <Plus size={16} /> Adicionar mensagem
              </Button>
            </div>
          )}

          {mode === 'paragraph' && (
            <div className="flex flex-col gap-2">
              {(config.pools ?? []).map((pool, pi) => (
                <Card key={pi}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-xs font-medium text-ink-secondary">
                      Paragrafo {pi + 1}
                    </span>
                    <span className="tnum text-xs text-ink-tertiary">
                      {pool.filter((v) => v.trim()).length} variacao(oes)
                    </span>
                    <div className="flex-1" />
                    {(config.pools?.length ?? 0) > 1 && (
                      <IconButton
                        label={`Remover paragrafo ${pi + 1}`}
                        onClick={() =>
                          setConfig({
                            ...config,
                            pools: (config.pools ?? []).filter((_, j) => j !== pi)
                          })
                        }
                        className="text-state-dangerText hover:bg-state-dangerWash"
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    {pool.map((v, vi) => (
                      <input
                        key={vi}
                        className={textareaCls}
                        placeholder={`Variacao ${vi + 1}`}
                        value={v}
                        onChange={(e) => {
                          const pools = (config.pools ?? []).map((p) => [...p])
                          pools[pi][vi] = e.target.value
                          setConfig({ ...config, pools })
                        }}
                      />
                    ))}
                    <button
                      onClick={() => {
                        const pools = (config.pools ?? []).map((p) => [...p])
                        pools[pi].push('')
                        setConfig({ ...config, pools })
                      }}
                      className="self-start rounded px-2 py-1 text-xs text-accent-text hover:bg-accent-wash"
                    >
                      + variacao
                    </button>
                  </div>
                </Card>
              ))}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setConfig({ ...config, pools: [...(config.pools ?? []), ['']] })}
                >
                  <Plus size={16} /> Adicionar paragrafo
                </Button>
                <span className="tnum text-sm text-accent-text">
                  {combos > 0
                    ? `${poolSizes(config.pools ?? []).join(' × ')} = ${combos} mensagens unicas`
                    : 'Preencha as variacoes para ver as combinacoes'}
                </span>
              </div>
            </div>
          )}

          {mode === 'ai' && (
            <EmptyState title="Modo IA chega na Fase 3">
              Vai gerar cada mensagem a partir do seu prompt, com pre-geracao e revisao antes do
              envio.
            </EmptyState>
          )}
        </StepSection>

        <StepSection
          step={4}
          title="Ritmo"
          hint="Intervalos aleatorios e descansos imitam o uso humano."
        >
          <Card>
            {pacing && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Intervalo minimo (ms)"
                    type="number"
                    value={pacing.delayMinMs}
                    onChange={(e) => setPacing({ ...pacing, delayMinMs: Number(e.target.value) })}
                  />
                  <Input
                    label="Intervalo maximo (ms)"
                    type="number"
                    value={pacing.delayMaxMs}
                    onChange={(e) => setPacing({ ...pacing, delayMaxMs: Number(e.target.value) })}
                  />
                  <Input
                    label="Descansar a cada N envios"
                    type="number"
                    value={pacing.restEveryN}
                    onChange={(e) => setPacing({ ...pacing, restEveryN: Number(e.target.value) })}
                  />
                  <Input
                    label="Teto diario"
                    type="number"
                    value={pacing.dailyCap}
                    onChange={(e) => setPacing({ ...pacing, dailyCap: Number(e.target.value) })}
                  />
                </div>
                <p className="mt-3 text-xs text-ink-tertiary">
                  Os valores padrao vem de Configuracoes. Alterar aqui vale so para esta campanha.
                </p>
              </>
            )}
          </Card>
        </StepSection>

        <StepSection
          step={5}
          title="Revisar e disparar"
          hint="Confira as amostras antes de enviar."
        >
          <div className="flex flex-col gap-3">
            <Card>
              <Input
                label="Nome da campanha (opcional)"
                placeholder="Ex.: Condicoes de julho"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Card>

            {plan && (
              <Card>
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-sm font-medium">Quem vai receber</span>
                  <div className="flex-1" />
                  <IconButton label="Recalcular" onClick={() => void refreshPlan()}>
                    <RefreshCw size={14} />
                  </IconButton>
                </div>

                <label className="mb-3 flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={skipAlreadySent}
                    onChange={(e) => setSkipAlreadySent(e.target.checked)}
                  />
                  <span>
                    Pular contatos que ja receberam mensagem desta base em campanhas anteriores
                    <span className="block text-xs text-ink-tertiary">
                      Evita mandar de novo para quem ja foi contatado. Desmarcado por padrao, pois
                      as vezes reenviar (ex.: uma nova oferta) e intencional.
                    </span>
                  </span>
                </label>

                <Table>
                  <tbody>
                    <tr>
                      <Td className="text-ink-secondary">Vao receber</Td>
                      <Td className="tnum w-24 text-right font-medium text-state-successText">
                        {plan.eligible}
                      </Td>
                    </tr>
                    <tr>
                      <Td className="text-ink-secondary">Fora: nao validados no WhatsApp</Td>
                      <Td className="tnum w-24 text-right">{plan.skippedUnchecked}</Td>
                    </tr>
                    <tr>
                      <Td className="text-ink-secondary">Fora: descadastrados</Td>
                      <Td className="tnum w-24 text-right">{plan.skippedOptOut}</Td>
                    </tr>
                    {skipAlreadySent && (
                      <tr>
                        <Td className="text-ink-secondary">Fora: ja receberam antes</Td>
                        <Td className="tnum w-24 text-right">{plan.skippedAlreadySent}</Td>
                      </tr>
                    )}
                  </tbody>
                </Table>

                {plan.samples.length > 0 && (
                  <div className="mt-4">
                    <span className="mb-2 block text-xs text-ink-secondary">
                      Amostras (ja renderizadas com dados reais dos contatos)
                    </span>
                    <div className="flex flex-col gap-2">
                      {plan.samples.map((s, i) => (
                        <div
                          key={i}
                          className="whitespace-pre-wrap rounded-lg border border-line bg-surface-base px-3 py-2 text-sm [text-wrap:pretty]"
                        >
                          {s}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            )}

            <Card className="flex flex-wrap items-center gap-4">
              <div className="min-w-0 flex-1 text-sm text-ink-secondary">
                {wa.status !== 'connected'
                  ? 'Conecte o WhatsApp em Configuracoes para disparar.'
                  : !listId
                    ? 'Escolha uma base de destino.'
                    : mode === 'ai'
                      ? 'O modo IA chega na Fase 3.'
                      : (plan?.eligible ?? 0) === 0
                        ? 'Nenhum contato elegivel. Valide os numeros na Base de Dados.'
                        : running
                          ? 'Ja existe um disparo em andamento.'
                          : `Pronto para enviar para ${plan?.eligible ?? 0} contato(s).`}
              </div>
              <Button onClick={handleStart} disabled={!canStart}>
                <Play size={16} /> {busy ? 'Iniciando...' : 'Iniciar disparo'}
              </Button>
            </Card>
          </div>
        </StepSection>
      </div>
    </PageBody>
  )
}
