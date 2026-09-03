import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, Plus, Send, Trash2 } from 'lucide-react'
import { Button, Card, EmptyState, IconButton, PageHeader, Pill } from '../components/ui'
import { AppointmentModal } from './KanbanPage'
import { formatJid } from '../format'
import type { CrmAppointment, ScheduledFollowUp } from '@shared/types'

const WEEKDAY_LABELS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab']

/** Meia-noite local do dia de `ts`. Chave para agrupar itens por dia. */
function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function hourLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/**
 * Item do calendario: compromisso marcado a mao ou follow-up que o cron ainda
 * vai disparar. Os dois convivem na mesma grade de proposito — a pergunta do
 * usuario e "o que acontece na quinta", nao "o que eu marquei na quinta".
 */
interface DayItem {
  key: string
  at: number
  title: string
  subtitle: string | null
  kind: 'appointment' | 'followup'
  done: boolean
  appointment: CrmAppointment | null
}

export default function AgendaPage(): JSX.Element {
  const [month, setMonth] = useState(() => {
    const d = new Date()
    d.setDate(1)
    d.setHours(0, 0, 0, 0)
    return d
  })
  const [appointments, setAppointments] = useState<CrmAppointment[]>([])
  const [followUps, setFollowUps] = useState<ScheduledFollowUp[]>([])
  // "Hoje" fica congelado na montagem da tela: ler o relogio durante o render
  // tornaria o componente impuro, e uma agenda aberta a noite nao precisa virar
  // o dia sozinha.
  const [today] = useState(() => startOfDay(Date.now()))
  const [selectedDay, setSelectedDay] = useState<number>(today)
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [a, f] = await Promise.all([
      window.api.agenda.list({ includeDone: true }),
      window.api.agenda.upcomingFollowUps(500)
    ])
    setAppointments(a)
    setFollowUps(f)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
    return window.api.crm.onChanged(() => void load())
  }, [load])

  const items = useMemo<DayItem[]>(() => {
    const fromAppointments: DayItem[] = appointments.map((a) => ({
      key: `a-${a.id}`,
      at: a.dueAt,
      title: a.title,
      subtitle: a.leadName,
      kind: 'appointment',
      done: a.done,
      appointment: a
    }))
    const fromFollowUps: DayItem[] = followUps.map((f) => ({
      key: `f-${f.ruleId}-${f.leadId}`,
      at: f.dueAt,
      title: f.ruleName,
      subtitle: f.leadName || formatJid(f.phoneE164),
      kind: 'followup',
      done: false,
      appointment: null
    }))
    return [...fromAppointments, ...fromFollowUps].sort((a, b) => a.at - b.at)
  }, [appointments, followUps])

  const byDay = useMemo(() => {
    const map = new Map<number, DayItem[]>()
    for (const item of items) {
      const day = startOfDay(item.at)
      const bucket = map.get(day)
      if (bucket) bucket.push(item)
      else map.set(day, [item])
    }
    return map
  }, [items])

  // Grade do mes comecando no domingo da semana da primeira linha, para as
  // colunas baterem com os rotulos dos dias da semana.
  const grid = useMemo(() => {
    const first = new Date(month)
    const start = new Date(first)
    start.setDate(1 - first.getDay())
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }, [month])

  const selectedItems = byDay.get(selectedDay) ?? []
  const pending = appointments.filter((a) => !a.done).length

  async function toggleDone(a: CrmAppointment): Promise<void> {
    await window.api.agenda.setDone(a.id, !a.done)
    void load()
  }

  async function remove(a: CrmAppointment): Promise<void> {
    if (!window.confirm(`Apagar "${a.title}"?`)) return
    await window.api.agenda.remove(a.id)
    void load()
  }

  return (
    <div className="mx-auto max-w-form px-8 pb-16 pt-8">
      <PageHeader
        title="Agenda"
        subtitle="Compromissos marcados por voce e os follow-ups que o cron ainda vai disparar, no mesmo calendario."
        aside={
          <Button onClick={() => setCreating(true)}>
            <Plus size={15} />
            Novo compromisso
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Pill>
          <CalendarDays size={13} />
          <span className="tnum">{pending}</span> compromisso(s) em aberto
        </Pill>
        <Pill>
          <Send size={13} />
          <span className="tnum">{followUps.length}</span> follow-up(s) previsto(s)
        </Pill>
      </div>

      <Card className="mb-6">
        <header className="mb-3 flex items-center gap-2">
          <IconButton
            label="Mes anterior"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          >
            <ChevronLeft size={16} />
          </IconButton>
          <h2 className="flex-1 text-center text-sm font-semibold capitalize">
            {month.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}
          </h2>
          <IconButton
            label="Proximo mes"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          >
            <ChevronRight size={16} />
          </IconButton>
        </header>

        <div className="grid grid-cols-7 gap-1">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="pb-1 text-center text-[10px] uppercase tracking-[.06em] text-ink-meta"
            >
              {label}
            </div>
          ))}

          {grid.map((day) => {
            const key = startOfDay(day.getTime())
            const dayItems = byDay.get(key) ?? []
            const otherMonth = day.getMonth() !== month.getMonth()
            const isToday = key === today
            const isSelected = key === selectedDay
            return (
              <button
                key={key}
                onClick={() => setSelectedDay(key)}
                className={`flex min-h-14 flex-col items-start gap-1 rounded border p-1.5 text-left transition-colors duration-120 ${
                  isSelected
                    ? 'border-accent-strong bg-accent-wash'
                    : 'border-line-subtle hover:bg-accent-wash'
                } ${otherMonth ? 'opacity-40' : ''}`}
              >
                <span
                  className={`tnum text-xs ${isToday ? 'font-semibold text-accent-text' : 'text-ink-secondary'}`}
                >
                  {day.getDate()}
                </span>
                {dayItems.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {dayItems.slice(0, 4).map((item) => (
                      <span
                        key={item.key}
                        className={`h-1.5 w-1.5 rounded-full ${
                          item.kind === 'followup'
                            ? 'bg-state-warning'
                            : item.done
                              ? 'bg-ink-tertiary'
                              : 'bg-accent'
                        }`}
                      />
                    ))}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-4 border-t border-line-subtle pt-3 text-[11px] text-ink-meta">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> compromisso
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-state-warning" /> follow-up automatico
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-ink-tertiary" /> concluido
          </span>
        </div>
      </Card>

      <h2 className="mb-3 text-lg font-semibold">
        {new Date(selectedDay).toLocaleDateString('pt-BR', {
          weekday: 'long',
          day: '2-digit',
          month: 'long'
        })}
      </h2>

      {loading ? (
        <p className="text-sm text-ink-tertiary">Carregando...</p>
      ) : selectedItems.length === 0 ? (
        <EmptyState title="Nada neste dia">
          Marque um compromisso aqui ou pelo cartao do lead no Kanban.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-2">
          {selectedItems.map((item) => (
            <Card key={item.key} className="flex flex-wrap items-center gap-3">
              <span className="tnum w-12 flex-none text-sm text-ink-secondary">
                {hourLabel(item.at)}
              </span>
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-sm ${item.done ? 'text-ink-tertiary line-through' : ''}`}
                >
                  {item.title}
                </p>
                {item.subtitle && <p className="truncate text-xs text-ink-meta">{item.subtitle}</p>}
              </div>

              {item.kind === 'followup' ? (
                <span className="flex-none rounded-full bg-state-warningWash px-2.5 py-1 text-[10px] text-state-warningText">
                  follow-up automatico
                </span>
              ) : (
                <>
                  <IconButton
                    label={item.done ? 'Reabrir' : 'Concluir'}
                    onClick={() => void toggleDone(item.appointment as CrmAppointment)}
                    className={item.done ? 'text-ink-tertiary' : 'text-state-successText'}
                  >
                    <Check size={15} />
                  </IconButton>
                  <IconButton
                    label="Apagar"
                    onClick={() => void remove(item.appointment as CrmAppointment)}
                    className="text-state-dangerText"
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </>
              )}
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <AppointmentModal
          leadId={null}
          leadLabel={null}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false)
            void load()
          }}
        />
      )}
    </div>
  )
}
