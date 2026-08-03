import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
import type { Chat, HistorySyncState, Message } from '@shared/types'
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

/**
 * Quantas mensagens a conversa mostra por vez.
 *
 * Abrir uma conversa com anos de historico nao pode montar milhares de bolhas
 * de uma vez. A janela cresce de 50 em 50 conforme o usuario rola para cima.
 */
const PAGE_SIZE = 50

export default function InboxPage(): JSX.Element {
  const wa = useWhatsapp()
  const [searchParams, setSearchParams] = useSearchParams()
  const [chats, setChats] = useState<Chat[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [sending, setSending] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showAttach, setShowAttach] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [total, setTotal] = useState(0)
  const [loadingOlder, setLoadingOlder] = useState(false)
  /** Pedimos historico ao WhatsApp e ainda nao chegou. Trava novos pedidos. */
  const [waitingWhatsapp, setWaitingWhatsapp] = useState(false)
  const [historySync, setHistorySync] = useState<HistorySyncState>({
    running: false,
    percent: null,
    messages: 0
  })
  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  /**
   * Quantas mensagens a conversa aberta esta mostrando.
   *
   * Em ref, e nao so em state, porque o recarregamento periodico precisa do
   * valor atual sem virar dependencia do efeito — senao cada "carregar mais"
   * recriaria o intervalo.
   */
  const limitRef = useRef(PAGE_SIZE)
  /** Altura da thread antes de crescer para cima, para nao perder a leitura. */
  const restoreRef = useRef<number | null>(null)
  /** O usuario esta no fim da conversa? So ai o refresh rola sozinho. */
  const nearBottomRef = useRef(true)
  const recorder = useVoiceRecorder()

  const loadChats = useCallback(async () => {
    setChats(await window.api.inbox.chats())
  }, [])

  // Leitura pura do banco local: nunca fala com o WhatsApp. Roda a cada evento
  // e a cada 10s, entao pedir historico daqui viraria rajada de requisicao.
  const loadMessages = useCallback(async (jid: string) => {
    const [rows, count] = await Promise.all([
      window.api.inbox.messages(jid, limitRef.current),
      window.api.inbox.count(jid)
    ])
    setMsgs(rows)
    setTotal(count)
    // Chegou mensagem alem da janela: o pedido ao WhatsApp foi atendido.
    if (count > rows.length) setWaitingWhatsapp(false)
  }, [])

  useEffect(() => {
    void loadChats()
  }, [loadChats])

  // O kanban abre a conversa de um lead por `/inbox?jid=...`. Roda uma vez por
  // jid pedido para nao brigar com o usuario se ele trocar de conversa depois.
  useEffect(() => {
    const jid = searchParams.get('jid')
    if (!jid) return
    setActive(jid)
    // Limpa o parametro: sem isso, voltar para a inbox por outro caminho
    // reabriria a mesma conversa.
    setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  // Atualiza quando o main avisa que algo mudou (mensagem nova, anexo baixado,
  // status de entrega, opt-out). '*' e o resumo de um lote de sincronizacao.
  useEffect(() => {
    const off = window.api.inbox.onChanged(({ chatJid }) => {
      void loadChats()
      if (active && (chatJid === active || chatJid === '*')) void loadMessages(active)
    })
    return off
  }, [active, loadChats, loadMessages])

  // Polling periódico: garante que a inbox se atualize mesmo que um evento
  // `inbox:changed` se perca.
  useEffect(() => {
    const interval = setInterval(() => {
      void loadChats()
      if (active) void loadMessages(active)
    }, 10_000)
    return () => clearInterval(interval)
  }, [active, loadChats, loadMessages])

  // Andamento da sincronizacao de historico, para a faixa no topo da conversa.
  useEffect(() => {
    void window.api.inbox.syncState().then(setHistorySync)
    return window.api.inbox.onSyncProgress(setHistorySync)
  }, [])

  /**
   * Posicao da thread depois de cada mudanca.
   *
   * Tres casos distintos: cresceu para cima (mantem a mensagem que o usuario
   * estava lendo no lugar), o usuario esta no fim (acompanha a conversa) ou ele
   * esta lendo mais acima (nao mexe — puxar a tela para baixo no meio da
   * leitura e o que mais irrita).
   */
  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    const before = restoreRef.current
    if (before != null) {
      el.scrollTop += el.scrollHeight - before
      restoreRef.current = null
      return
    }
    if (nearBottomRef.current) el.scrollTop = el.scrollHeight
  }, [msgs])

  async function openChat(jid: string): Promise<void> {
    setActive(jid)
    // Cada conversa comeca pela janela mais recente; o historico cresce ao rolar.
    limitRef.current = PAGE_SIZE
    nearBottomRef.current = true
    restoreRef.current = null
    setWaitingWhatsapp(false)
    await loadMessages(jid)
    await window.api.inbox.markRead(jid)
    await loadChats()
  }

  /**
   * Chamado quando a rolagem chega perto do topo.
   *
   * Serve primeiro o que ja esta no banco. So quando ele acaba e que pede ao
   * WhatsApp — e ai trava novos pedidos ate a resposta chegar, para rolar rapido
   * nao virar uma sequencia de requisicoes.
   */
  const loadOlder = useCallback(async () => {
    const jid = active
    const el = threadRef.current
    if (!jid || !el || loadingOlder) return

    const hasMoreLocal = total > msgs.length
    if (!hasMoreLocal && waitingWhatsapp) return

    setLoadingOlder(true)
    try {
      if (hasMoreLocal) {
        restoreRef.current = el.scrollHeight
        limitRef.current += PAGE_SIZE
        await loadMessages(jid)
        return
      }
      const requested = await window.api.inbox.requestOlder(jid)
      setWaitingWhatsapp(requested)
    } finally {
      setLoadingOlder(false)
    }
  }, [active, loadingOlder, loadMessages, msgs.length, total, waitingWhatsapp])

  function handleThreadScroll(el: HTMLDivElement): void {
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (el.scrollTop <= 40) void loadOlder()
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

  /**
   * Botao de sincronizar.
   *
   * Antes ele so reconsultava foto de perfil, o que fazia o usuario clicar
   * esperando trazer mensagem e nao receber nenhuma. Agora tambem pede o
   * historico anterior da conversa aberta — uma conversa por clique, que e o
   * ritmo combinado para nao rajar o servidor do WhatsApp.
   */
  async function handleResync(): Promise<void> {
    setSyncing(true)
    try {
      await window.api.inbox.resync()
      if (active) {
        const requested = await window.api.inbox.requestOlder(active)
        setWaitingWhatsapp(requested)
      }
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
            aria-label="Sincronizar conversas"
            title="Sincronizar fotos de perfil e buscar o historico anterior da conversa aberta"
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

            {historySync.running && (
              <div className="flex items-center gap-2 border-b border-line bg-accent-wash px-4 py-2 text-xs text-accent-text">
                <RefreshCw size={13} className="flex-none animate-[dfspin_1s_linear_infinite]" />
                <span>
                  Sincronizando o historico do WhatsApp
                  {historySync.percent != null ? ` — ${historySync.percent}%` : ''}
                  {historySync.messages > 0 ? ` (${historySync.messages} mensagens)` : ''}
                </span>
              </div>
            )}

            <div
              ref={threadRef}
              onScroll={(e) => handleThreadScroll(e.currentTarget)}
              className="flex-1 space-y-2 overflow-y-auto px-4 py-4"
            >
              {/* Topo da thread: diz se ainda ha passado para carregar. */}
              {msgs.length > 0 && (
                <p className="pb-2 text-center text-[11px] text-ink-tertiary">
                  {loadingOlder
                    ? 'Carregando mensagens anteriores...'
                    : total > msgs.length
                      ? `Role para cima para ver as ${total - msgs.length} mensagens anteriores`
                      : waitingWhatsapp
                        ? 'Buscando mais historico no WhatsApp...'
                        : 'Inicio da conversa'}
                </p>
              )}
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
