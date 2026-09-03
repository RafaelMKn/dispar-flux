import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, Plus, Send, Timer, Trash2 } from 'lucide-react'
import {
  Button,
  Callout,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Pill,
  Select,
  Toggle
} from '../components/ui'
import { formatDateTime, formatMinuteOfDay, parseMinuteOfDay } from '../format'
import type {
  ContactList,
  FollowUpMode,
  FollowUpPreview,
  FollowUpRule,
  FollowUpRuleInput
} from '@shared/types'

const WEEKDAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const WEEKDAY_NAMES = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado']

const NEW_RULE: FollowUpRuleInput = {
  name: '',
  listId: null,
  afterHours: 48,
  mode: 'fixed',
  config: { text: '' },
  weekdays: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 18 * 60,
  maxFollowUps: 1,
  enabled: true
}

export default function CronPage(): JSX.Element {
  const [rules, setRules] = useState<FollowUpRule[]>([])
  const [lists, setLists] = useState<ContactList[]>([])
  const [editing, setEditing] = useState<{ id: string | null; input: FollowUpRuleInput } | null>(
    null
  )
  const [loading, setLoading] = useState(true)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [r, l] = await Promise.all([window.api.followups.list(), window.api.contactLists.list()])
    setRules(r)
    setLists(l)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function toast(message: string): void {
    setFlash(message)
    setTimeout(() => setFlash(null), 3200)
  }

  async function save(id: string | null, input: FollowUpRuleInput): Promise<void> {
    if (id) await window.api.followups.update(id, input)
    else await window.api.followups.create(input)
    setEditing(null)
    void load()
  }

  async function remove(rule: FollowUpRule): Promise<void> {
    if (!window.confirm(`Apagar a regra "${rule.name}"?`)) return
    await window.api.followups.remove(rule.id)
    void load()
  }

  async function runNow(rule: FollowUpRule): Promise<void> {
    if (
      !window.confirm(
        `Disparar "${rule.name}" agora, fora da janela de horario? As mensagens comecam a sair imediatamente.`
      )
    ) {
      return
    }
    try {
      const result = await window.api.followups.runNow(rule.id)
      toast(
        result
          ? `Follow-up iniciado: ${result.queued} mensagem(ns) na fila.`
          : 'Ninguem elegivel agora — ou todos ja responderam, ou o WhatsApp esta desconectado, ou ha campanha em andamento.'
      )
      void load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Falha ao disparar o follow-up.')
    }
  }

  return (
    <div className="mx-auto max-w-form px-8 pb-16 pt-8">
      <PageHeader
        title="Cron"
        subtitle="Regras que reenviam mensagem para quem recebeu o disparo e nao respondeu, dentro do horario que voce permitir."
        aside={
          <Button onClick={() => setEditing({ id: null, input: NEW_RULE })}>
            <Plus size={15} />
            Nova regra
          </Button>
        }
      />

      <div className="mb-6">
        <Callout tone="warning">
          Follow-up automatico e o tipo de envio que mais irrita quem nao pediu contato. Prefira
          prazos largos, no maximo um ou dois degraus e horario comercial. Quem pedir descadastro
          fica de fora sozinho, e o teto diario de envios continua valendo.{' '}
          <Link to="/docs/crm" className="font-medium text-accent-text underline">
            Como montar uma regra
          </Link>
          .
        </Callout>
      </div>

      {loading ? (
        <p className="text-sm text-ink-tertiary">Carregando...</p>
      ) : rules.length === 0 ? (
        <EmptyState title="Nenhuma regra ainda">
          Uma regra procura leads sem resposta e enfileira uma nova campanha para eles — com o mesmo
          pacing e as mesmas protecoes do disparo manual.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          {rules.map((rule) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              listName={lists.find((l) => l.id === rule.listId)?.name ?? null}
              onEdit={() => setEditing({ id: rule.id, input: toInput(rule) })}
              onToggle={async (enabled) => {
                await window.api.followups.setEnabled(rule.id, enabled)
                void load()
              }}
              onRemove={() => void remove(rule)}
              onRunNow={() => void runNow(rule)}
            />
          ))}
        </div>
      )}

      {editing && (
        <RuleModal
          id={editing.id}
          initial={editing.input}
          lists={lists}
          onClose={() => setEditing(null)}
          onSave={(input) => void save(editing.id, input)}
        />
      )}

      {flash && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm animate-[dfin_180ms_ease-out] rounded-lg border border-line bg-surface-raised px-4 py-3 text-sm shadow-float">
          {flash}
        </div>
      )}
    </div>
  )
}

/** Regra salva -> campos editaveis do formulario. */
function toInput(rule: FollowUpRule): FollowUpRuleInput {
  return {
    name: rule.name,
    listId: rule.listId,
    afterHours: rule.afterHours,
    mode: rule.mode,
    config: rule.config,
    weekdays: rule.weekdays,
    startMinute: rule.startMinute,
    endMinute: rule.endMinute,
    maxFollowUps: rule.maxFollowUps,
    enabled: rule.enabled
  }
}

/* ── Cartao da regra ────────────────────────────────────────────────────── */

function RuleCard({
  rule,
  listName,
  onEdit,
  onToggle,
  onRemove,
  onRunNow
}: {
  rule: FollowUpRule
  listName: string | null
  onEdit: () => void
  onToggle: (enabled: boolean) => Promise<void>
  onRemove: () => void
  onRunNow: () => void
}): JSX.Element {
  const [preview, setPreview] = useState<FollowUpPreview | null>(null)

  // A previa e uma varredura no banco; carregar por cartao evita segurar a
  // pagina inteira enquanto ela roda.
  useEffect(() => {
    let alive = true
    void window.api.followups.preview(rule.id).then((p) => {
      if (alive) setPreview(p)
    })
    return () => {
      alive = false
    }
  }, [rule])

  const days =
    rule.weekdays.length === 7
      ? 'todos os dias'
      : rule.weekdays.length === 0
        ? 'nenhum dia'
        : rule.weekdays.map((d) => WEEKDAY_NAMES[d].slice(0, 3)).join(', ')

  return (
    <Card className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="truncate text-base font-medium">{rule.name}</h2>
          {!rule.enabled && (
            <span className="rounded-full bg-surface-sunken px-2 py-0.5 text-[10px] text-ink-meta">
              pausada
            </span>
          )}
        </div>

        <p className="mt-1 text-sm text-ink-secondary">
          {rule.afterHours} h sem resposta · ate {rule.maxFollowUps} envio
          {rule.maxFollowUps > 1 ? 's' : ''} · {listName ?? 'todas as bases'}
        </p>

        <div className="mt-2 flex flex-wrap gap-2">
          <Pill>
            <Clock size={12} />
            {days}, {formatMinuteOfDay(rule.startMinute)}–{formatMinuteOfDay(rule.endMinute)}
          </Pill>
          {preview && (
            <Pill>
              <Timer size={12} />
              <span className="tnum">{preview.eligible}</span> elegivel(is) agora
            </Pill>
          )}
          {preview && !preview.windowOpen && (
            <Pill>abre em {formatDateTime(preview.nextWindowAt)}</Pill>
          )}
          {rule.lastRunAt && <Pill>ultima execucao {formatDateTime(rule.lastRunAt)}</Pill>}
        </div>
      </div>

      <div className="flex flex-none flex-col items-end gap-2">
        <Toggle
          checked={rule.enabled}
          onChange={(next) => void onToggle(next)}
          label={rule.enabled ? 'Ativa' : 'Pausada'}
        />
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onRunNow} disabled={preview?.eligible === 0}>
            <Send size={15} />
            Disparar agora
          </Button>
          <Button variant="secondary" onClick={onEdit}>
            Editar
          </Button>
          <Button variant="danger" onClick={onRemove}>
            <Trash2 size={15} />
          </Button>
        </div>
      </div>
    </Card>
  )
}

/* ── Formulario ─────────────────────────────────────────────────────────── */

function RuleModal({
  id,
  initial,
  lists,
  onClose,
  onSave
}: {
  id: string | null
  initial: FollowUpRuleInput
  lists: ContactList[]
  onClose: () => void
  onSave: (input: FollowUpRuleInput) => void
}): JSX.Element {
  const [form, setForm] = useState<FollowUpRuleInput>(initial)

  function patch(next: Partial<FollowUpRuleInput>): void {
    setForm((f) => ({ ...f, ...next }))
  }

  function toggleDay(day: number): void {
    patch({
      weekdays: form.weekdays.includes(day)
        ? form.weekdays.filter((d) => d !== day)
        : [...form.weekdays, day].sort((a, b) => a - b)
    })
  }

  const messages = form.config.messages ?? ['']
  const hasText =
    form.mode === 'fixed'
      ? Boolean(form.config.text?.trim())
      : messages.some((m) => m.trim().length > 0)
  const valid = Boolean(form.name.trim()) && hasText && form.weekdays.length > 0

  return (
    <Modal
      title={id ? 'Editar regra' : 'Nova regra de follow-up'}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(form)} disabled={!valid}>
            Salvar
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Nome da regra"
          value={form.name}
          onChange={(e) => patch({ name: e.target.value })}
          placeholder="Primeira cobranca"
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label="Horas sem resposta"
            type="number"
            min={1}
            value={form.afterHours}
            onChange={(e) => patch({ afterHours: Number(e.target.value) || 1 })}
            hint="Contadas a partir do ultimo contato nosso."
          />
          <Input
            label="Maximo por lead"
            type="number"
            min={1}
            max={5}
            value={form.maxFollowUps}
            onChange={(e) => patch({ maxFollowUps: Number(e.target.value) || 1 })}
            hint="Quantos follow-ups a mesma pessoa pode receber."
          />
          <Select
            label="Base"
            value={form.listId ?? ''}
            onChange={(e) => patch({ listId: e.target.value || null })}
          >
            <option value="">Todas as bases</option>
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        </div>

        <div>
          <span className="mb-1.5 block text-xs text-ink-secondary">Dias permitidos</span>
          <div className="flex gap-1.5">
            {WEEKDAY_LABELS.map((label, day) => {
              const on = form.weekdays.includes(day)
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  aria-pressed={on}
                  aria-label={WEEKDAY_NAMES[day]}
                  title={WEEKDAY_NAMES[day]}
                  className={`h-9 w-9 flex-none rounded border text-sm transition-colors duration-120 ${
                    on
                      ? 'border-accent-strong bg-accent-wash font-medium text-accent-text'
                      : 'border-line text-ink-secondary hover:bg-accent-wash'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="A partir de"
            type="time"
            value={formatMinuteOfDay(form.startMinute)}
            onChange={(e) => {
              const m = parseMinuteOfDay(e.target.value)
              if (m != null) patch({ startMinute: m })
            }}
          />
          <Input
            label="Ate"
            type="time"
            value={formatMinuteOfDay(form.endMinute)}
            onChange={(e) => {
              const m = parseMinuteOfDay(e.target.value)
              if (m != null) patch({ endMinute: m })
            }}
            hint="Fora dessa faixa o envio espera a janela abrir."
          />
        </div>

        <Select
          label="Mensagem"
          value={form.mode}
          onChange={(e) => {
            const mode = e.target.value as FollowUpMode
            patch({ mode, config: mode === 'fixed' ? { text: '' } : { messages: [''] } })
          }}
          hint="Variacoes reduzem o risco de o WhatsApp ver o envio como automatizado."
        >
          <option value="fixed">Mensagem fixa</option>
          <option value="rotate">Variacoes alternadas</option>
        </Select>

        {form.mode === 'fixed' ? (
          <MessageArea
            value={form.config.text ?? ''}
            onChange={(text) => patch({ config: { text } })}
          />
        ) : (
          <div className="flex flex-col gap-2">
            {messages.map((message, i) => (
              <div key={i} className="flex items-start gap-2">
                <MessageArea
                  value={message}
                  onChange={(text) => {
                    const next = [...messages]
                    next[i] = text
                    patch({ config: { messages: next } })
                  }}
                />
                {messages.length > 1 && (
                  <Button
                    variant="ghost"
                    onClick={() =>
                      patch({ config: { messages: messages.filter((_, j) => j !== i) } })
                    }
                  >
                    <Trash2 size={15} />
                  </Button>
                )}
              </div>
            ))}
            <div>
              <Button
                variant="secondary"
                onClick={() => patch({ config: { messages: [...messages, ''] } })}
              >
                <Plus size={15} />
                Nova variacao
              </Button>
            </div>
          </div>
        )}

        <Toggle
          checked={form.enabled}
          onChange={(enabled) => patch({ enabled })}
          label="Regra ativa"
          hint="Pausada, a regra fica salva mas o agendador nao dispara nada."
        />
      </div>
    </Modal>
  )
}

function MessageArea({
  value,
  onChange
}: {
  value: string
  onChange: (value: string) => void
}): JSX.Element {
  return (
    <label className="block flex-1">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder="Oi {{nome}}, passando para saber se voce chegou a ver minha mensagem."
        className="w-full resize-y rounded border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none transition-colors duration-120 placeholder:text-ink-tertiary hover:border-ink-tertiary focus-visible:border-accent-strong"
      />
      <span className="mt-1 block text-xs text-ink-tertiary">
        Use <code>{'{{nome}}'}</code> e as colunas da sua base, igual na tela de Disparo.
      </span>
    </label>
  )
}
