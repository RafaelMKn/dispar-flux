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
import type {
  Chat,
  ChatSyncOutcome,
  ChatSyncResult,
  ChatSyncState,
  HistorySyncState,
  LeadSyncStop,
  Message
} from '@shared/types'
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

/**
 * Quantas conversas a lista carrega.
 *
 * O mesmo motivo do PAGE_SIZE, e mais um: esta lista e recarregada a cada
 * evento da inbox. Com milhares de conversas, cada evento serializava alguns MB
 * pelo IPC e remontava a lista inteira — era o principal travamento do app.
 * Quem procura uma conversa fora das 100 mais recentes usa a busca, que filtra
 * no banco.
 */
const CHAT_PAGE_SIZE = 100

/** Janelas oferecidas no menu de sincronizacao de uma conversa. */
const SYNC_RANGES: { label: string; days: number | null }[] = [
  { label: 'Ultimos 7 dias', days: 7 },
  { label: 'Ultimos 30 dias', days: 30 },
  { label: 'Conversa completa', days: null }
]

/**
 * O QUE O USUARIO PRECISA SABER ANTES DE PEDIR HISTORICO.
 *
 * Quem responde pedido de mensagem antiga e o CELULAR pareado, nao o servidor
 * do WhatsApp: com o aparelho desligado, sem internet ou com o app fechado, o
 * pedido simplesmente fica sem resposta. E lento por natureza — nao ha o que
 * otimizar aqui, so o que avisar.
 */
const SYNC_WARNING =
  'O historico antigo vem do seu celular: mantenha-o ligado, com internet e o WhatsApp aberto. Pode levar varios minutos.'

/**
 * UMA FRASE POR DESFECHO, E CADA UMA DIZ A VERDADE.
 *
 * A versao anterior era uma cadeia de `if` sobre booleanos, e tinha dois
 * defeitos graves: o caminho "nao consegui nem pedir" terminava acusando o
 * celular de ter parado de responder, e qualquer estado nao previsto caia no
 * "Nada novo veio desta vez." — que soa como sucesso.
 *
 * Aqui o mapa e indexado pelo tipo: um desfecho novo sem frase nao compila.
 * REGRA: `requestFailed`, `busy`, `offline` e `noAnchor` NUNCA mencionam o
 * aparelho, porque em nenhum deles o aparelho chegou a ser consultado.
 */
const SYNC_MESSAGE: Record<ChatSyncOutcome, (r: ChatSyncResult) => string> = {
  offline: () => 'WhatsApp desconectado — reconecte para sincronizar.',
  requestFailed: () => 'Nao foi possivel enviar o pedido ao WhatsApp. Tente de novo em instantes.',
  busy: () =>
    'Havia outra sincronizacao em andamento e esta nao chegou a ser enviada. Tente de novo em instantes.',
  noAnchor: () =>
    'Esta conversa ainda nao tem nenhuma mensagem vinda do WhatsApp para servir de ponto de partida — so o que foi enviado por aqui. Ela ganha uma assim que o celular mandar a primeira mensagem ou alguem responder.',
  awaitingPhone: (r) =>
    (r.fetched > 0 ? `${r.fetched} mensagem(ns) trazida(s). ` : '') +
    'O restante foi pedido ao celular, que monta o historico e envia quando puder — pode levar varios minutos. Deixe-o ligado, com internet e o WhatsApp aberto: o que chegar entra sozinho na conversa.',
  exhausted: (r) =>
    r.fetched > 0
      ? `${r.fetched} mensagem(ns) trazida(s) — conversa completa.`
      : 'Nao ha mais historico anterior no WhatsApp.',
  reachedTarget: (r) => `${r.fetched} mensagem(ns) trazida(s).`,
  fetched: (r) => `${r.fetched} mensagem(ns) trazida(s).`
}

function describeSync(r: ChatSyncResult): string {
  return SYNC_MESSAGE[r.outcome](r)
}

/** Por que a fila da base parou. Mesma regra: so acusa o celular quando e ele. */
const LEAD_STOP_MESSAGE: Record<LeadSyncStop, string> = {
  phoneQuiet:
    'A sincronizacao pausou: os pedidos foram enviados e as respostas ainda nao chegaram. O celular envia quando puder — mantenha-o ligado, com internet e o WhatsApp aberto. O que chegar entra sozinho.',
  requestFailed:
    'A sincronizacao parou: nao foi possivel enviar o pedido ao WhatsApp. Tente de novo em instantes.',
  offline: 'A sincronizacao parou: o WhatsApp desconectou. Reconecte para retomar.',
  busy: 'A sincronizacao parou: havia outro pedido de historico em andamento. Tente de novo em instantes.'
}

function syncLabel(chat: Chat): string {
  if (chat.syncedFull) return 'Conversa completa sincronizada'
  if (chat.syncedFrom == null) return 'Conversa ainda nao sincronizada'
  const dias = Math.max(0, Math.round((Date.now() - chat.syncedFrom) / 86_400_000))
  if (dias === 0) return 'Sincronizada a partir de hoje'
  return `Sincronizada desde ${new Date(chat.syncedFrom).toLocaleDateString('pt-BR')} (${dias} dia${dias === 1 ? '' : 's'})`
}

export default function InboxPage(): JSX.Element {
  const wa = useWhatsapp()
  const [searchParams, setSearchParams] = useSearchParams()
  const [chats, setChats] = useState<Chat[]>([])
  const [active, setActive] = useState<string | null>(null)
  /**
   * A conversa aberta vem do main, e nao da lista.
   *
   * A lista e limitada a 100 e pode estar filtrada pela base de leads — a
   * conversa aberta pelo kanban (`/inbox?jid=...`) ou escondida pelo filtro
   * ficaria sem cabecalho se dependesse dela.
   */
  const [activeChat, setActiveChat] = useState<Chat | null>(null)
  const [msgs, setMsgs] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [sending, setSending] = useState(false)
  const [showEmoji, setShowEmoji] = useState(false)
  const [showAttach, setShowAttach] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [showSyncMenu, setShowSyncMenu] = useState(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  /** Foco na base de leads: e o modo padrao da tela (ver comentario abaixo). */
  const [onlyLeads, setOnlyLeads] = useState(true)
  const [leadCount, setLeadCount] = useState(0)
  const [leadSync, setLeadSync] = useState<ChatSyncState>({
    running: false,
    done: 0,
    total: 0,
    jid: null,
    fetched: 0,
    stoppedReason: null
  })
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

  /**
   * Filtro e busca vao para o BANCO, nao para o renderer.
   *
   * Em ref alem de state porque o recarregamento periodico e o disparado por
   * evento precisam do valor atual sem virar dependencia dos efeitos — senao
   * digitar na busca recriaria o intervalo a cada tecla.
   */
  const queryRef = useRef({ onlyLeads: true, search: '' })
  useEffect(() => {
    queryRef.current = { onlyLeads, search }
  }, [onlyLeads, search])

  const loadChats = useCallback(async () => {
    const { onlyLeads: leads, search: term } = queryRef.current
    setChats(
      await window.api.inbox.chats({
        limit: CHAT_PAGE_SIZE,
        onlyLeads: leads,
        search: term.trim() || undefined
      })
    )
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

  const loadActiveChat = useCallback(async (jid: string | null) => {
    setActiveChat(jid ? await window.api.inbox.chat(jid) : null)
  }, [])

  useEffect(() => {
    void loadActiveChat(active)
  }, [active, chats, loadActiveChat])

  // Filtro/busca: recarrega com um respiro, para nao consultar o banco a cada
  // tecla digitada.
  useEffect(() => {
    const t = setTimeout(() => void loadChats(), search ? 250 : 0)
    return () => clearTimeout(t)
  }, [loadChats, search, onlyLeads])

  // Quantas conversas sao da base. Zero significa que o modo "base de leads"
  // esconderia tudo — nesse caso a tela cai para "todas" sozinha.
  useEffect(() => {
    void window.api.inbox.leadCount().then((n) => {
      setLeadCount(n)
      if (n === 0) setOnlyLeads(false)
    })
  }, [])

  useEffect(() => {
    void window.api.inbox.leadSyncState().then(setLeadSync)
    return window.api.inbox.onLeadSync((s) => {
      setLeadSync(s)
      if (!s.running) void window.api.inbox.leadCount().then(setLeadCount)
    })
  }, [])

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

  /**
   * Atualiza quando o main avisa que algo mudou (mensagem nova, anexo baixado,
   * status de entrega, opt-out). '*' e o resumo de um lote de sincronizacao.
   *
   * Os eventos vem AOS MONTES durante a sincronizacao. Recarregar a cada um
   * deles fazia a tela remontar a lista dezenas de vezes por segundo — entao
   * eles sao agrupados numa recarga so a cada 400ms.
   */
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let reloadThread = false

    const off = window.api.inbox.onChanged(({ chatJid }) => {
      if (active && (chatJid === active || chatJid === '*')) reloadThread = true
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        void loadChats()
        if (reloadThread && active) {
          reloadThread = false
          void loadMessages(active)
        }
      }, 400)
    })
    return () => {
      off()
      if (timer) clearTimeout(timer)
    }
  }, [active, loadChats, loadMessages])

  /**
   * O historico pedido chegou depois de a tela ja ter dito "ainda nao chegou".
   *
   * Sem isto o usuario ficava com aquela frase na tela enquanto as mensagens ja
   * tinham entrado na conversa — e concluia (de novo) que o app nao sincroniza.
   */
  useEffect(() => {
    return window.api.inbox.onHistoryLate(({ chatJid, inserted }) => {
      if (chatJid !== active) return
      setSyncNote(
        inserted > 0
          ? `Chegou o historico pedido: ${inserted} mensagem(ns).`
          : 'O celular respondeu ao pedido de historico.'
      )
    })
  }, [active])

  // Polling periódico: garante que a inbox se atualize mesmo que um evento
  // `inbox:changed` se perca. Espacado, porque cada rodada e uma releitura da
  // lista inteira — a atualizacao de verdade vem pelos eventos acima.
  useEffect(() => {
    const interval = setInterval(() => {
      void loadChats()
      if (active) void loadMessages(active)
    }, 30_000)
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
    setSyncNote(null)
    setShowSyncMenu(false)
    await loadMessages(jid)
    await window.api.inbox.markRead(jid)
    await loadChats()

    // Conversa pouco sincronizada abre praticamente vazia. O main decide se
    // vale pedir historico (7 dias, 30 para numero da base) e faz isso uma vez
    // por sessao; aqui so mostramos que esta acontecendo.
    setSyncing(true)
    try {
      const r = await window.api.inbox.opened(jid)
      if (r && r.fetched > 0) {
        await loadMessages(jid)
        await loadChats()
      }
      // So avisa quando ha algo a dizer: abrir conversa ja sincronizada nao
      // pode encher a tela de recado. `busy` e `requestFailed` ficam de fora de
      // proposito — a sincronizacao automatica ao abrir e melhor-esforco, e nao
      // vale assustar quem so queria ler a conversa.
      const valeAvisar =
        r && (r.outcome === 'noAnchor' || r.outcome === 'awaitingPhone' || r.fetched > 0)
      if (r && valeAvisar) setSyncNote(describeSync(r))
    } finally {
      setSyncing(false)
    }
  }

  /**
   * Sincronizacao pedida pelo usuario: 7 dias, 30 dias ou a conversa inteira.
   *
   * Demora — o main repete os pedidos ao WhatsApp no ritmo seguro ate alcancar
   * a janela — entao a tela fica com o botao girando e o resultado aparece no
   * fim, em vez de fingir que foi instantaneo.
   */
  async function handleSyncChat(days: number | null): Promise<void> {
    const jid = active
    setShowSyncMenu(false)
    if (!jid || syncing) return

    setSyncing(true)
    setSyncNote(
      days == null ? 'Sincronizando a conversa completa...' : `Sincronizando ${days} dias...`
    )
    try {
      const r = await window.api.inbox.syncChat(jid, days)
      await loadMessages(jid)
      await loadChats()
      setSyncNote(describeSync(r))
    } finally {
      setSyncing(false)
    }
  }

  /** Sincroniza por inteiro as conversas de quem esta na base de leads. */
  async function handleSyncLeads(): Promise<void> {
    if (leadSync.running) {
      await window.api.inbox.cancelLeadSync()
      return
    }
    await window.api.inbox.syncLeads()
    await loadChats()
    if (active) await loadMessages(active)
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
   * Botao de atualizar da lista: fotos de perfil e releitura.
   *
   * Buscar mensagem NAO e trabalho dele — isso agora tem lugar proprio (o menu
   * de sincronizacao da conversa e o "Sincronizar base"), onde da para escolher
   * o periodo em vez de torcer para vir alguma coisa.
   */
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

  // A filtragem acontece no banco (ver `loadChats`): filtrar aqui obrigaria a
  // trazer a inbox inteira pelo IPC, que e justamente o que travava a tela.
  const filtered = chats
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
            aria-label="Atualizar lista de conversas"
            title="Atualizar a lista e as fotos de perfil"
            className="rounded p-1.5 text-ink-secondary transition-colors duration-120 hover:bg-accent-wash disabled:opacity-40"
          >
            <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
          </button>
          <StatusDot tone={connected ? 'success' : 'idle'} />
        </div>

        <div className="space-y-2 px-4 py-3">
          <div className="flex items-center gap-2 rounded border border-line bg-surface-raised px-3 py-2">
            <Search size={16} className="flex-none text-ink-tertiary" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar conversa"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-tertiary"
            />
          </div>

          {/*
            Foco na base de leads.

            A inbox de quem prospecta tem milhares de conversas que nao
            interessam; as que interessam sao os numeros da base. Por isso este
            e o modo padrao — e so ele recebe sincronizacao da conversa inteira.
          */}
          <div className="flex items-center gap-1.5">
            {[
              { label: `Base de leads${leadCount > 0 ? ` (${leadCount})` : ''}`, value: true },
              { label: 'Todas', value: false }
            ].map((opt) => (
              <button
                key={String(opt.value)}
                onClick={() => setOnlyLeads(opt.value)}
                aria-pressed={onlyLeads === opt.value}
                className={[
                  'rounded-full border px-2.5 py-1 text-[11px] transition-colors duration-120',
                  onlyLeads === opt.value
                    ? 'border-accent-strong bg-accent-wash text-accent-text'
                    : 'border-line text-ink-secondary hover:bg-accent-wash'
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
            <div className="flex-1" />
            <button
              onClick={handleSyncLeads}
              disabled={!connected}
              title="Sincroniza a conversa COMPLETA de cada numero da base de leads, uma por vez"
              className="rounded border border-line px-2 py-1 text-[11px] text-ink-secondary transition-colors duration-120 hover:bg-accent-wash disabled:opacity-40"
            >
              {leadSync.running ? 'Parar' : 'Sincronizar base'}
            </button>
          </div>

          {leadSync.running && (
            <p className="text-[11px] text-ink-tertiary [text-wrap:pretty]">
              Sincronizando base: {leadSync.done}/{leadSync.total} conversas
              {leadSync.fetched > 0 ? ` — ${leadSync.fetched} mensagens` : ''}. {SYNC_WARNING}
            </p>
          )}
          {!leadSync.running && leadSync.stoppedReason && (
            <p className="text-[11px] text-state-warningText [text-wrap:pretty]">
              {LEAD_STOP_MESSAGE[leadSync.stoppedReason]}
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-6 py-8 text-center text-xs text-ink-tertiary [text-wrap:pretty]">
              {!connected
                ? 'Conecte o WhatsApp em Configuracoes para ver suas conversas.'
                : search.trim()
                  ? 'Nenhuma conversa encontrada para esta busca.'
                  : onlyLeads
                    ? 'Nenhuma conversa com numero da base de leads. Importe uma base ou veja "Todas".'
                    : 'Nenhuma conversa ainda. Quando alguem te mandar mensagem, ela aparece aqui.'}
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
                    {c.isLead && !onlyLeads && (
                      <span className="flex-none rounded-full bg-accent-wash px-1.5 text-[10px] text-accent-text">
                        base
                      </span>
                    )}
                    <div className="flex-1" />
                    {/* Sem data quando nao ha mensagem: melhor vazio do que a
                        data de hoje, que era o que dava a impressao de que todo
                        numero sincronizado tinha acabado de falar. */}
                    <span className="tnum flex-none text-[11px] text-ink-tertiary">
                      {timeLabel(c.lastTs)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs text-ink-meta">
                      {c.lastMessage ?? (c.lastTs == null ? 'Sem historico sincronizado' : '')}
                    </span>
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
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">
                    {activeChat.name || formatJid(activeChat.jid)}
                  </span>
                  {activeChat.isLead && (
                    <span className="flex-none rounded-full bg-accent-wash px-1.5 text-[10px] text-accent-text">
                      base de leads
                    </span>
                  )}
                </div>
                <div className="tnum text-[11px] text-ink-meta">
                  {formatJid(activeChat.jid)} — {syncLabel(activeChat)}
                </div>
              </div>

              <div className="flex-1" />

              {/*
                Sincronizacao desta conversa: 7 dias, 30 dias ou tudo.

                Fica aqui, e nao no topo da lista, porque cada pedido e uma ida
                ao servidor do WhatsApp para UMA conversa — e a conversa em
                questao e sempre a que esta aberta.
              */}
              <div className="relative flex-none">
                {showSyncMenu && (
                  <div className="absolute right-0 top-full z-30 mt-2 w-72 overflow-hidden rounded-lg border border-line bg-surface-raised shadow-float">
                    <p className="border-b border-line-subtle px-3 py-2 text-[11px] leading-snug text-ink-meta [text-wrap:pretty]">
                      {SYNC_WARNING}
                    </p>
                    {SYNC_RANGES.map((r) => (
                      <button
                        key={r.label}
                        onClick={() => void handleSyncChat(r.days)}
                        className="block w-full px-3 py-2.5 text-left text-sm hover:bg-accent-wash"
                      >
                        {r.label}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => setShowSyncMenu((v) => !v)}
                  disabled={!connected || syncing}
                  aria-label="Sincronizar esta conversa"
                  title="Sincronizar esta conversa (7 dias, 30 dias ou completa)"
                  className="rounded p-1.5 text-ink-secondary transition-colors duration-120 hover:bg-accent-wash disabled:opacity-40"
                >
                  <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {syncNote && (
              <div className="border-b border-line bg-surface-sunken px-4 py-1.5 text-[11px] text-ink-meta">
                {syncNote}
              </div>
            )}

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
