import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Search,
  MessageCircle,
  Send,
  ArrowLeft,
  ShieldOff,
  Smile,
  Paperclip,
  Mic,
  Trash2,
  Image as ImageIcon,
  FileText,
  Music,
  RefreshCw
} from 'lucide-react'
import type { Chat, Message } from '@shared/types'
import { EmptyState, Button, StatusDot } from '../components/ui'
import { Avatar } from '../components/Avatar'
import { EmojiPicker } from '../components/EmojiPicker'
import { MessageBubble } from '../components/MessageBubble'
import { useWhatsapp } from '../useWhatsapp'
import { useVoiceRecorder } from '../useVoiceRecorder'
import { formatJid, formatDuration } from '../format'

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

const ATTACH_OPTIONS = [
  { kind: 'media' as const, icon: ImageIcon, label: 'Imagem ou video' },
  { kind: 'document' as const, icon: FileText, label: 'Documento' },
  { kind: 'audio' as const, icon: Music, label: 'Arquivo de audio' }
]

export default function InboxPage(): JSX.Element {
  const wa = useWhatsapp()
  const [chats, setChats] = useState<Chat[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [sending, setSending] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showAttach, setShowAttach] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const recorder = useVoiceRecorder()

  const loadChats = useCallback(async () => {
    setChats(await window.api.inbox.chats())
  }, [])

  const loadMessages = useCallback(async (jid: string) => {
    setMsgs(await window.api.inbox.messages(jid))
  }, [])

  useEffect(() => {
    void loadChats()
  }, [loadChats])

  // Atualiza quando o main avisa que algo mudou (mensagem nova, anexo baixado,
  // status de entrega, opt-out). '*' e o resumo de um lote de sincronizacao.
  useEffect(() => {
    const off = window.api.inbox.onChanged(({ chatJid }) => {
      void loadChats()
      if (active && (chatJid === active || chatJid === '*')) void loadMessages(active)
    })
    return off
  }, [active, loadChats, loadMessages])

  // Polling periodico: garante que a inbox se atualize mesmo que um evento
  // `inbox:changed` se perca (ex.: envio em massa pela campanha, reconexao,
  // ou se o renderer nao estava inscrito no momento exato).
  useEffect(() => {
    const interval = setInterval(() => {
      void loadChats()
      if (active) void loadMessages(active)
    }, 10_000)
    return () => clearInterval(interval)
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

  async function handleAttach(kind: 'media' | 'document' | 'audio'): Promise<void> {
    setShowAttach(false)
    if (!active || sending) return
    const picked = await window.api.inbox.pickAttachment(kind)
    if (!picked) return

    setSending(true)
    try {
      // O texto ja digitado vira legenda do anexo — e o que o usuario espera de
      // quem escreveu antes de clicar no clipe.
      await window.api.inbox.sendMedia(active, {
        filePath: picked.filePath,
        kind: picked.kind,
        fileName: picked.fileName,
        mime: picked.mime,
        caption: draft.trim() || undefined
      })
      setDraft('')
      await loadMessages(active)
      await loadChats()
    } finally {
      setSending(false)
    }
  }

  async function handleStopRecording(): Promise<void> {
    const audio = await recorder.stop()
    if (!audio || !active) return
    setSending(true)
    try {
      await window.api.inbox.sendVoice(active, audio.base64, audio.seconds)
      await loadMessages(active)
      await loadChats()
    } finally {
      setSending(false)
    }
  }

  function insertEmoji(emoji: string): void {
    const input = inputRef.current
    if (!input) {
      setDraft((d) => d + emoji)
      return
    }
    // Insere na posicao do cursor, nao no fim: emoji no meio da frase e o uso
    // normal, e sempre-no-fim obrigaria a recortar e colar.
    const start = input.selectionStart ?? draft.length
    const end = input.selectionEnd ?? draft.length
    setDraft(draft.slice(0, start) + emoji + draft.slice(end))
    requestAnimationFrame(() => {
      input.focus()
      input.setSelectionRange(start + emoji.length, start + emoji.length)
    })
  }

  async function handleResync(): Promise<void> {
    setSyncing(true)
    try {
      await window.api.inbox.resync()
      await loadChats()
      if (active) await loadMessages(active)
    } finally {
      setSyncing(false)
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
  const connected = wa.status === 'connected'
  const busy = sending || recorder.recording

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
          <button
            onClick={handleResync}
            disabled={!connected || syncing}
            aria-label="Sincronizar conversas e fotos"
            title="Sincronizar conversas e fotos de perfil"
            className="rounded p-1.5 text-ink-secondary transition-colors duration-120 hover:bg-accent-wash disabled:opacity-40"
          >
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
          </button>
          <StatusDot tone={connected ? 'success' : 'idle'} />
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
              {connected
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
                <Avatar name={c.name} jid={c.jid} url={c.avatarUrl} size={36} />
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
      <div
        className={['min-w-0 flex-1 flex-col', active ? 'flex' : 'hidden min-[1100px]:flex'].join(
          ' '
        )}
      >
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
              <Avatar
                name={activeChat.name}
                jid={activeChat.jid}
                url={activeChat.avatarUrl}
                size={34}
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {activeChat.name || formatJid(activeChat.jid)}
                </div>
                <div className="tnum text-[11px] text-ink-meta">{formatJid(activeChat.jid)}</div>
              </div>
            </div>

            <div ref={threadRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
              {msgs.map((m) => (
                <MessageBubble
                  key={m.id}
                  message={m}
                  onDownload={(id) => void window.api.inbox.downloadMedia(id)}
                  onOpen={(id) => void window.api.inbox.openMedia(id)}
                  onSaveAs={(id) => void window.api.inbox.saveMediaAs(id)}
                />
              ))}
              {msgs.length === 0 && (
                <p className="py-8 text-center text-xs text-ink-tertiary">
                  Nenhuma mensagem nesta conversa ainda.
                </p>
              )}
            </div>

            <div className="border-t border-line bg-surface-sunken px-4 py-3">
              {!connected && (
                <div className="mb-2 flex items-center gap-2 text-xs text-state-warningText">
                  <ShieldOff size={14} /> WhatsApp desconectado — reconecte para responder.
                </div>
              )}
              {recorder.error && (
                <div className="mb-2 text-xs text-state-dangerText">{recorder.error}</div>
              )}

              {recorder.recording ? (
                <div className="flex items-center gap-3 rounded border border-line bg-surface-raised px-3 py-2">
                  <span className="h-2 w-2 flex-none animate-pulse rounded-full bg-state-danger" />
                  <span className="tnum text-sm">Gravando {formatDuration(recorder.seconds)}</span>
                  <div className="flex-1" />
                  <button
                    onClick={recorder.cancel}
                    aria-label="Descartar gravacao"
                    title="Descartar"
                    className="rounded p-1.5 text-ink-secondary hover:bg-accent-wash"
                  >
                    <Trash2 size={16} />
                  </button>
                  <Button onClick={handleStopRecording} disabled={sending}>
                    <Send size={16} /> Enviar audio
                  </Button>
                </div>
              ) : (
                <div className="relative flex items-end gap-2">
                  <div className="relative flex-none">
                    {showEmoji && (
                      <EmojiPicker onPick={insertEmoji} onClose={() => setShowEmoji(false)} />
                    )}
                    <button
                      onClick={() => {
                        setShowEmoji((v) => !v)
                        setShowAttach(false)
                      }}
                      disabled={!connected}
                      aria-label="Inserir emoji"
                      title="Emoji"
                      className="grid h-[38px] w-9 place-items-center rounded text-ink-secondary hover:bg-accent-wash disabled:opacity-40"
                    >
                      <Smile size={18} />
                    </button>
                  </div>

                  <div className="relative flex-none">
                    {showAttach && (
                      <div className="absolute bottom-full left-0 z-30 mb-2 w-56 overflow-hidden rounded-lg border border-line bg-surface-raised shadow-float">
                        {ATTACH_OPTIONS.map((opt) => (
                          <button
                            key={opt.kind}
                            onClick={() => void handleAttach(opt.kind)}
                            className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-accent-wash"
                          >
                            <opt.icon size={16} className="flex-none text-ink-secondary" />
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => {
                        setShowAttach((v) => !v)
                        setShowEmoji(false)
                      }}
                      disabled={!connected || busy}
                      aria-label="Anexar arquivo"
                      title="Anexar"
                      className="grid h-[38px] w-9 place-items-center rounded text-ink-secondary hover:bg-accent-wash disabled:opacity-40"
                    >
                      <Paperclip size={18} />
                    </button>
                  </div>

                  <textarea
                    ref={inputRef}
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
                    disabled={!connected}
                    className="max-h-32 min-h-[38px] w-full resize-y rounded border border-line bg-surface-raised px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-tertiary focus-visible:border-accent-strong disabled:opacity-50"
                  />

                  {draft.trim() ? (
                    <Button onClick={handleSend} disabled={sending || !connected}>
                      <Send size={16} /> Enviar
                    </Button>
                  ) : (
                    <button
                      onClick={() => void recorder.start()}
                      disabled={!connected || busy}
                      aria-label="Gravar nota de voz"
                      title="Gravar nota de voz"
                      className="grid h-[38px] w-[38px] flex-none place-items-center rounded bg-btn text-btn-ink transition-colors duration-120 hover:bg-btn-hover disabled:opacity-45"
                    >
                      <Mic size={17} />
                    </button>
                  )}
                </div>
              )}
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
