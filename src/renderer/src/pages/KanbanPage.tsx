import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  BellPlus,
  Columns3,
  MessageCircle,
  Plus,
  Trash2,
  UserX
} from 'lucide-react'
import {
  Button,
  EmptyState,
  IconButton,
  Input,
  Modal,
  PageHeader,
  Pill,
  StatusDot
} from '../components/ui'
import { formatElapsed, formatJid, formatDateTime } from '../format'
import { useCrm } from '../useCrm'
import type { CrmLead, CrmStage } from '@shared/types'

/** Marcador do dado arrastado. Uma string so; o cartao cabe todo no id. */
const DRAG_TYPE = 'application/x-dispar-lead'

export default function KanbanPage(): JSX.Element {
  const { board, loading, reload } = useCrm()
  const navigate = useNavigate()
  const [dragging, setDragging] = useState<string | null>(null)
  const [hoverStage, setHoverStage] = useState<string | null>(null)
  const [detail, setDetail] = useState<CrmLead | null>(null)
  const [managing, setManaging] = useState(false)

  const byStage = useMemo(() => {
    const map = new Map<string, CrmLead[]>()
    for (const stage of board.stages) map.set(stage.id, [])
    for (const lead of board.leads) map.get(lead.stageId)?.push(lead)
    return map
  }, [board])

  async function drop(stageId: string): Promise<void> {
    const leadId = dragging
    setDragging(null)
    setHoverStage(null)
    if (!leadId) return
    await window.api.crm.moveLead(leadId, stageId)
    reload()
  }

  const waiting = board.leads.filter((l) => l.firstReplyAt == null && l.firstSentAt != null).length
  const replied = board.leads.filter((l) => l.firstReplyAt != null).length

  return (
    // Altura cheia com rolagem horizontal so nas colunas: o <main> ja rola na
    // vertical, e deixar a pagina rolar de lado tiraria o cabecalho da tela.
    <div className="flex h-full min-w-0 flex-col px-8 pb-6 pt-8">
      <PageHeader
        title="Kanban"
        subtitle="Os leads entram quando o disparo sai e andam sozinhos para a coluna de em andamento assim que o cliente responde."
        aside={
          <Button variant="secondary" onClick={() => setManaging(true)}>
            <Columns3 size={15} />
            Colunas
          </Button>
        }
      />

      {board.leads.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Pill>
            <StatusDot tone="idle" />
            <span className="tnum">{waiting}</span> sem resposta
          </Pill>
          <Pill>
            <StatusDot tone="success" />
            <span className="tnum">{replied}</span> responderam
          </Pill>
          <Pill>
            <span className="tnum">{board.leads.length}</span> leads no total
          </Pill>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-tertiary">Carregando...</p>
      ) : board.leads.length === 0 ? (
        <EmptyState title="Nenhum lead ainda">
          O cartao aparece aqui assim que a primeira campanha enviar para um contato da sua base.
          Quem responde muda de coluna sozinho.{' '}
          <Link to="/docs/crm" className="font-medium text-accent-text underline">
            Como o funil funciona
          </Link>
          .
        </EmptyState>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-2">
          {board.stages.map((stage) => {
            const leads = byStage.get(stage.id) ?? []
            const isTarget = hoverStage === stage.id
            return (
              <section
                key={stage.id}
                onDragOver={(e) => {
                  // Sem o preventDefault o navegador recusa o drop.
                  e.preventDefault()
                  setHoverStage(stage.id)
                }}
                onDragLeave={() => setHoverStage((s) => (s === stage.id ? null : s))}
                onDrop={(e) => {
                  e.preventDefault()
                  void drop(stage.id)
                }}
                className={`flex w-72 flex-none flex-col rounded-lg border bg-surface-sunken p-2 transition-colors duration-120 ${
                  isTarget ? 'border-accent-strong bg-accent-wash' : 'border-line'
                }`}
              >
                <header className="flex items-center gap-2 px-1.5 pb-2 pt-1">
                  <h2 className="truncate text-sm font-semibold">{stage.name}</h2>
                  {stage.role && (
                    <span className="flex-none rounded-full bg-accent-wash px-2 py-0.5 text-[10px] font-medium text-accent-text">
                      {stage.role === 'entry' ? 'entrada' : 'automatico'}
                    </span>
                  )}
                  <div className="flex-1" />
                  <span className="tnum flex-none text-xs text-ink-meta">{leads.length}</span>
                </header>

                <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                  {leads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      dragging={dragging === lead.id}
                      onDragStart={() => setDragging(lead.id)}
                      onDragEnd={() => setDragging(null)}
                      onOpen={() => setDetail(lead)}
                    />
                  ))}
                  {leads.length === 0 && (
                    <p className="px-1.5 py-6 text-center text-xs text-ink-tertiary">
                      Arraste um cartao para ca
                    </p>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {detail && (
        <LeadModal
          lead={detail}
          stages={board.stages}
          onClose={() => setDetail(null)}
          onChanged={reload}
          onOpenChat={(jid) => navigate(`/inbox?jid=${encodeURIComponent(jid)}`)}
        />
      )}

      {managing && (
        <StagesModal stages={board.stages} onClose={() => setManaging(false)} onChanged={reload} />
      )}
    </div>
  )
}

/* ── Cartao ─────────────────────────────────────────────────────────────── */

function LeadCard({
  lead,
  dragging,
  onDragStart,
  onDragEnd,
  onOpen
}: {
  lead: CrmLead
  dragging: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onOpen: () => void
}): JSX.Element {
  const label = lead.name?.trim() || formatJid(lead.phoneE164)
  // Ha quanto tempo o lead esta parado: conta do ultimo contato de qualquer
  // lado, porque e isso que diz se ele precisa de atencao.
  const idleSince = lead.lastInboundAt ?? lead.lastFollowUpAt ?? lead.firstSentAt

  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData(DRAG_TYPE, lead.id)
        onDragStart()
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      className={`cursor-grab rounded border border-line bg-surface-raised p-2.5 text-left shadow-flat transition-opacity duration-120 hover:border-ink-tertiary ${
        dragging ? 'opacity-40' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium">{label}</h3>
        {lead.unread > 0 && (
          <span className="tnum flex-none rounded-full bg-btn px-1.5 text-[10px] font-semibold text-btn-ink">
            {lead.unread > 99 ? '99+' : lead.unread}
          </span>
        )}
      </div>

      {lead.name && (
        <p className="tnum mt-0.5 truncate text-xs text-ink-meta">{formatJid(lead.phoneE164)}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-meta">
        <span title="Tempo desde o ultimo contato">{formatElapsed(idleSince)}</span>
        {lead.firstReplyAt == null && lead.firstSentAt != null && <span>sem resposta</span>}
        {lead.followUps > 0 && (
          <span className="tnum">
            {lead.followUps} follow-up{lead.followUps > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {(lead.optOut || lead.ignoredAutoReplies > 0) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {lead.optOut && (
            <span className="inline-flex items-center gap-1 rounded-full bg-state-dangerWash px-2 py-0.5 text-[10px] text-state-dangerText">
              <UserX size={10} />
              descadastrado
            </span>
          )}
          {lead.ignoredAutoReplies > 0 && (
            <span
              className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] text-ink-meta"
              title="Respostas descartadas por chegarem rapido demais para serem humanas"
            >
              {lead.ignoredAutoReplies} automatica
              {lead.ignoredAutoReplies > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </article>
  )
}

/* ── Detalhe do lead ────────────────────────────────────────────────────── */

function LeadModal({
  lead,
  stages,
  onClose,
  onChanged,
  onOpenChat
}: {
  lead: CrmLead
  stages: CrmStage[]
  onClose: () => void
  onChanged: () => void
  onOpenChat: (jid: string) => void
}): JSX.Element {
  const [notes, setNotes] = useState(lead.notes ?? '')
  const [scheduling, setScheduling] = useState(false)
  const label = lead.name?.trim() || formatJid(lead.phoneE164)

  async function save(): Promise<void> {
    await window.api.crm.setLeadNotes(lead.id, notes)
    onChanged()
    onClose()
  }

  async function remove(): Promise<void> {
    if (!window.confirm(`Tirar ${label} do CRM? A conversa e o contato na base continuam.`)) return
    await window.api.crm.removeLead(lead.id)
    onChanged()
    onClose()
  }

  if (scheduling) {
    return (
      <AppointmentModal
        leadId={lead.id}
        leadLabel={label}
        onClose={() => setScheduling(false)}
        onSaved={() => {
          setScheduling(false)
          onChanged()
        }}
      />
    )
  }

  return (
    <Modal
      title={label}
      onClose={onClose}
      footer={
        <>
          <Button variant="danger" onClick={() => void remove()}>
            <Trash2 size={15} />
            Remover do CRM
          </Button>
          <div className="flex-1" />
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void save()}>Salvar</Button>
        </>
      }
    >
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <Fact label="Telefone" value={formatJid(lead.phoneE164)} />
        <Fact label="Coluna" value={stages.find((s) => s.id === lead.stageId)?.name ?? '—'} />
        <Fact label="Base" value={lead.listName ?? 'base removida'} />
        <Fact label="Campanha" value={lead.campaignName ?? '—'} />
        <Fact label="Disparo enviado" value={formatDateTime(lead.firstSentAt)} />
        <Fact
          label="Primeira resposta"
          value={lead.firstReplyAt ? formatDateTime(lead.firstReplyAt) : 'ainda nao respondeu'}
        />
        <Fact label="Follow-ups enviados" value={String(lead.followUps)} />
        <Fact
          label="Respostas automaticas"
          value={
            lead.ignoredAutoReplies > 0
              ? `${lead.ignoredAutoReplies} descartada(s)`
              : 'nenhuma descartada'
          }
        />
      </dl>

      {lead.optOut && (
        <p className="mt-4 rounded border border-line bg-state-dangerWash px-3 py-2 text-xs text-state-dangerText">
          Este contato pediu descadastro. Nenhum disparo nem follow-up sera enviado para ele.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {lead.jid && (
          <Button variant="secondary" onClick={() => onOpenChat(lead.jid as string)}>
            <MessageCircle size={15} />
            Abrir conversa
          </Button>
        )}
        <Button variant="secondary" onClick={() => setScheduling(true)}>
          <BellPlus size={15} />
          Agendar compromisso
        </Button>
      </div>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs text-ink-secondary">Anotacoes</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder="O que ficou combinado com este lead"
          className="w-full resize-y rounded border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors duration-120 placeholder:text-ink-tertiary hover:border-ink-tertiary focus-visible:border-accent-strong"
        />
      </label>
    </Modal>
  )
}

function Fact({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-meta">{label}</dt>
      <dd className="truncate">{value}</dd>
    </div>
  )
}

/* ── Compromisso rapido a partir do cartao ──────────────────────────────── */

export function AppointmentModal({
  leadId,
  leadLabel,
  onClose,
  onSaved
}: {
  leadId: string | null
  leadLabel: string | null
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const [title, setTitle] = useState('')
  // Padrao: amanha as 09:00. Marcar compromisso para "agora" nunca e o que a
  // pessoa quer, e um campo vazio obrigaria a digitar a data inteira.
  const [when, setWhen] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    d.setHours(9, 0, 0, 0)
    return toLocalInput(d)
  })
  const [notes, setNotes] = useState('')

  async function save(): Promise<void> {
    const dueAt = new Date(when).getTime()
    if (!title.trim() || Number.isNaN(dueAt)) return
    await window.api.agenda.create({ leadId, title, notes: notes || null, dueAt })
    onSaved()
  }

  return (
    <Modal
      title={leadLabel ? `Agendar — ${leadLabel}` : 'Novo compromisso'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} disabled={!title.trim()}>
            Agendar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Input
          label="O que fazer"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ligar para fechar a proposta"
        />
        <Input
          label="Quando"
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          hint="O app avisa por notificacao do sistema no horario, mesmo minimizado na bandeja."
        />
        <Input
          label="Observacao (opcional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </Modal>
  )
}

/** Date -> "YYYY-MM-DDTHH:mm" no fuso local, que e o que o input espera. */
export function toLocalInput(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/* ── Gerenciar colunas ──────────────────────────────────────────────────── */

function StagesModal({
  stages,
  onClose,
  onChanged
}: {
  stages: CrmStage[]
  onClose: () => void
  onChanged: () => void
}): JSX.Element {
  const [novo, setNovo] = useState('')

  async function create(): Promise<void> {
    if (!novo.trim()) return
    await window.api.crm.createStage(novo)
    setNovo('')
    onChanged()
  }

  async function rename(stage: CrmStage): Promise<void> {
    const name = window.prompt('Novo nome da coluna', stage.name)
    if (name == null) return
    await window.api.crm.renameStage(stage.id, name)
    onChanged()
  }

  async function move(stage: CrmStage, direction: -1 | 1): Promise<void> {
    await window.api.crm.moveStage(stage.id, direction)
    onChanged()
  }

  async function remove(stage: CrmStage): Promise<void> {
    const destino = stages.find((s) => s.id !== stage.id)
    if (!destino) return
    if (
      !window.confirm(`Apagar a coluna "${stage.name}"? Os leads dela vao para "${destino.name}".`)
    ) {
      return
    }
    await window.api.crm.removeStage(stage.id, destino.id)
    onChanged()
  }

  return (
    <Modal
      title="Colunas do kanban"
      onClose={onClose}
      footer={<Button onClick={onClose}>Concluido</Button>}
    >
      <p className="mb-4 text-xs text-ink-meta [text-wrap:pretty]">
        As colunas marcadas como <strong>entrada</strong> e <strong>automatico</strong> sao usadas
        pela automacao: o lead nasce na primeira quando o disparo sai e vai para a segunda quando o
        cliente responde. Da para renomear as duas, mas nao apagar.
      </p>

      <div className="flex flex-col gap-2">
        {stages.map((stage, index) => (
          <div key={stage.id} className="flex items-center gap-2 rounded border border-line p-2">
            <span className="min-w-0 flex-1 truncate text-sm">{stage.name}</span>
            {stage.role && (
              <span className="flex-none rounded-full bg-accent-wash px-2 py-0.5 text-[10px] font-medium text-accent-text">
                {stage.role === 'entry' ? 'entrada' : 'automatico'}
              </span>
            )}
            <IconButton
              label="Mover para a esquerda"
              disabled={index === 0}
              onClick={() => void move(stage, -1)}
              className="h-8 w-8 disabled:opacity-30"
            >
              <ArrowLeft size={14} />
            </IconButton>
            <IconButton
              label="Mover para a direita"
              disabled={index === stages.length - 1}
              onClick={() => void move(stage, 1)}
              className="h-8 w-8 disabled:opacity-30"
            >
              <ArrowRight size={14} />
            </IconButton>
            <Button variant="ghost" onClick={() => void rename(stage)}>
              Renomear
            </Button>
            {stage.role === null && (
              <IconButton
                label="Apagar coluna"
                onClick={() => void remove(stage)}
                className="h-8 w-8 text-state-dangerText"
              >
                <Trash2 size={14} />
              </IconButton>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Nova coluna"
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Proposta enviada"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void create()
            }}
          />
        </div>
        <Button onClick={() => void create()} disabled={!novo.trim()}>
          <Plus size={15} />
          Criar
        </Button>
      </div>
    </Modal>
  )
}
