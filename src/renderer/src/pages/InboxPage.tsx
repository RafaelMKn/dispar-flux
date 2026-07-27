import { useCallback, useEffect, useRef, useState } from 'react'
import { Search, MessageCircle, Send, ArrowLeft, ShieldOff } from 'lucide-react'
import type { Chat, Message } from '@shared/types'
import { EmptyState, Button, StatusDot } from '../components/ui'
import { useWhatsapp } from '../useWhatsapp'
import { formatJid } from '../format'

function timeLabel(ts: number | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  const hoje = new Date()
  const mesmoDia =
    d.getDate() === hoje.getDate() &&
    d.getMonth() === hoje.getMonth() &&
    d.getFullYear() === hoje.getFullYear()
  return mesmoDia
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

export default function InboxPage(): JSX.Element {
  const wa = useWhatsapp()
  const [chats, setChats] = useState<Chat[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [sending, setSending] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)

  const loadChats = useCallback(async () => {
    setChats(await window.api.inbox.chats())
  }, [])

  const loadMessages = useCallback(async (jid: string) => {
    setMsgs(await window.api.inbox.messages(jid))
  }, [])

  useEffect(() => {
    void loadChats()
  }, [loadChats])

  // Atualiza quando o main avisa que algo mudou (mensagem nova, opt-out).
  useEffect(() => {
    const off = window.api.inbox.onChanged(({ chatJid }) => {
      void loadChats()
      if (chatJid === active) void loadMessages(chatJid)
    })
    return off
  }, [active, loadChats, loadMessages])

  // Rola para a ultima mensagem sempre que a thread muda.
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [msgs])

  async function openChat(jid: string): Promise<void> {
    setActive(jid)
    await loadMessages(jid)
    await window.api.inbox.markRead(jid)
    await loadChats()
  }

  async function handleSend(): Promise<void> {
    const text = draft.trim()
    if (!text || !active || sending) return
    setSending(true)
    try {
      await window.api.inbox.send(active, text)
      setDraft('')
      await loadMessages(active)
      await loadChats()
    } finally {
      setSending(false)
    }
  }

  const filtered = search.trim()
    ? chats.filter((c) => {
        const t = search.trim().toLowerCase()
        return (
          (c.name ?? '').toLowerCase().includes(t) ||
          c.jid.includes(t.replace(/\D/g, '')) ||
          (c.lastMessage ?? '').toLowerCase().includes(t)
        )
      })
    : chats

  const activeChat = chats.find((c) => c.jid === active) ?? null

  return (
    <div className="flex h-full min-w-0">
      {/* Lista de conversas — abaixo de 1100px so aparece quando nada esta aberto */}
      <div
        className={[
          'w-full flex-none flex-col border-r border-line bg-surface-sunken min-[1100px]:flex min-[1100px]:w-80',
          active ? 'hidden min-[1100px]:flex' : 'flex'
        ].join(' ')}
      >
        <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
          <h1 className="text-lg font-semibold">Conversas</h1>
          <div className="flex-1" />
          <StatusDot tone={wa.status === 'connected' ? 'success' : 'idle'} />
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center gap-2 rounded border border-line bg-surface-raised px-3 py-2">
            <Search size={16} className="flex-none text-ink-tertiary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversa"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-tertiary"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-6 py-8 text-center text-xs text-ink-tertiary [text-wrap:pretty]">
              {wa.status === 'connected'
                ? 'Nenhuma conversa ainda. Quando alguem te mandar mensagem, ela aparece aqui.'
                : 'Conecte o WhatsApp em Configuracoes para ver suas conversas.'}
            </p>
          ) : (
            filtered.map((c) => (
              <button
                key={c.jid}
                onClick={() => void openChat(c.jid)}
                className={[
                  'flex w-full items-start gap-3 border-b border-line-subtle px-4 py-3 text-left transition-colors duration-120',
                  c.jid === active ? 'bg-accent-wash' : 'hover:bg-accent-wash'
                ].join(' ')}
              >
                <div className="grid h-9 w-9 flex-none place-items-center rounded-full bg-surface-raised text-xs font-semibold text-ink-secondary">
                  {(c.name ?? formatJid(c.jid)).slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium">
                      {c.name || formatJid(c.jid)}
                    </span>
                    <div className="flex-1" />
                    <span className="tnum flex-none text-[11px] text-ink-tertiary">
                      {timeLabel(c.lastTs)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs text-ink-meta">{c.lastMessage ?? ''}</span>
                    {c.unread > 0 && (
                      <span className="tnum ml-auto flex-none rounded-full bg-btn px-1.5 text-[10px] font-semibold text-btn-ink">
                        {c.unread}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Thread */}
      <div className={['min-w-0 flex-1 flex-col', active ? 'flex' : 'hidden min-[1100px]:flex'].join(' ')}>
        {activeChat ? (
          <>
            <div className="flex items-center gap-3 border-b border-line bg-surface-sunken px-4 py-3">
              <button
                onClick={() => setActive(null)}
                className="grid h-8 w-8 place-items-center rounded text-ink-secondary hover:bg-accent-wash min-[1100px]:hidden"
                aria-label="Voltar para a lista"
              >
                <ArrowLeft size={18} />
              </button>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {activeChat.name || formatJid(activeChat.jid)}
                </div>
                <div className="tnum text-[11px] text-ink-meta">{formatJid(activeChat.jid)}</div>
              </div>
            </div>

            <div ref={threadRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {msgs.map((m) => {
                const out = m.direction === 'out'
                return (
                  <div key={m.id} className={out ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      className={[
                        'max-w-[min(78%,520px)] rounded-lg px-3 py-2 text-sm [text-wrap:pretty]',
                        out
                          ? 'bg-accent-wash text-ink'
                          : 'border border-line bg-surface-raised text-ink'
                      ].join(' ')}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className="tnum mt-1 text-right text-[10px] text-ink-tertiary">
                        {new Date(m.ts).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </div>
                    </div>
                  </div>
                )
              })}
              {msgs.length === 0 && (
                <p className="py-8 text-center text-xs text-ink-tertiary">
                  Nenhuma mensagem nesta conversa ainda.
                </p>
              )}
            </div>

            <div className="border-t border-line bg-surface-sunken px-4 py-3">
              {wa.status !== 'connected' && (
                <div className="mb-2 flex items-center gap-2 text-xs text-state-warningText">
                  <ShieldOff size={14} /> WhatsApp desconectado — reconecte para responder.
                </div>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter envia; Shift+Enter quebra linha.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void handleSend()
                    }
                  }}
                  rows={1}
                  placeholder="Escreva uma mensagem"
                  disabled={wa.status !== 'connected'}
                  className="max-h-32 min-h-[38px] w-full resize-y rounded border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-tertiary focus-visible:border-accent-strong disabled:opacity-50"
                />
                <Button
                  onClick={handleSend}
                  disabled={!draft.trim() || sending || wa.status !== 'connected'}
                >
                  <Send size={16} /> Enviar
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="grid flex-1 place-items-center p-8">
            <div className="w-full max-w-md">
              <EmptyState title="Selecione uma conversa">
                <MessageCircle className="mx-auto mb-3 text-ink-tertiary" size={36} />
                As mensagens chegam localmente, direto no app — sem servidor nem webhook publico.
                Quem responder <strong>SAIR</strong> e descadastrado automaticamente.
              </EmptyState>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
