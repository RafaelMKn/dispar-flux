import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { initDb } from '../../db'

/**
 * O cliente do WhatsApp e trocado por um dublê: o que interessa testar aqui e a
 * DISCIPLINA da sincronizacao (pedir, esperar a RESPOSTA do celular, parar
 * quando nao vem mais nada), nao o Baileys.
 */
const socket = { fake: true }
const fetchOlderMessages = vi.fn()
vi.mock('./client', () => ({
  whatsapp: {
    get socket() {
      return socketRef.current
    },
    fetchOlderMessages: (...args: unknown[]) => fetchOlderMessages(...args)
  }
}))

const socketRef: { current: unknown } = { current: socket }

import { syncChatHistory, autoSyncOnOpen, resetAutoSync, timings } from './historySync'
import { inboxEvents } from './inbox'
import { insertMessages, upsertChat, getChat, setChatSync } from '../../repos/chats'

beforeAll(async () => {
  await initDb()
})

beforeEach(() => {
  fetchOlderMessages.mockReset()
  socketRef.current = socket
  resetAutoSync()
  // Tempos de teste: o que importa e a sequencia de pedidos, nao a espera real.
  timings.roundTimeoutMs = 150
  timings.retryMs = 20
})

let counter = 0
function freshJid(): string {
  counter += 1
  return `5511960${String(counter).padStart(6, '0')}@s.whatsapp.net`
}

const DAY = 24 * 60 * 60 * 1000

/**
 * Mensagem vinda do WhatsApp: com id real e carimbo do servidor.
 *
 * O carimbo e truncado para o segundo de proposito — e o que o WhatsApp manda,
 * e e o que faz a linha poder virar ancora (ver `oldestAnchor`).
 */
function seed(jid: string, ts: number, id = `S${(counter += 1)}`): void {
  const waTs = Math.floor(ts / 1000) * 1000
  insertMessages([
    { id, chatJid: jid, direction: 'in', body: 'oi', ts: waTs, waTs, waMessageId: id }
  ])
  upsertChat(jid, { lastMessage: 'oi', lastTs: waTs })
}

/** Mensagem gravada pelo proprio app ao enviar: relogio local, sem carimbo. */
function seedLocal(jid: string, ts: number, id = `campaign-${(counter += 1)}`): void {
  insertMessages([{ id, chatJid: jid, direction: 'out', body: 'oi', ts, waMessageId: null }])
  upsertChat(jid, { lastMessage: 'oi', lastTs: ts })
}

/** Pedido aceito pelo Baileys, no formato novo de `fetchOlderMessages`. */
function sent(requestId: string | null = null): { sent: true; requestId: string | null } {
  return { sent: true, requestId }
}

/** Simula o celular respondendo o pedido: chega um lote de historico. */
function answer(jid: string, opts: { withOlder?: number } = {}): void {
  if (opts.withOlder) seed(jid, opts.withOlder)
  inboxEvents.emit('historyBatch', { requestId: null, inserted: {}, jids: [jid] })
}

describe('syncChatHistory', () => {
  it('pede lotes ate alcancar a janela de dias e para ali', async () => {
    const jid = freshJid()
    seed(jid, Date.now() - DAY)

    // Cada resposta do celular "traz" mais tres dias de passado.
    let dias = 1
    fetchOlderMessages.mockImplementation(async () => {
      dias += 3
      setTimeout(() => answer(jid, { withOlder: Date.now() - dias * DAY }), 5)
      return sent('req-1')
    })

    const r = await syncChatHistory(jid, 7)

    expect(r.reachedTarget).toBe(true)
    expect(r.exhausted).toBe(false)
    expect(r.timedOut).toBe(false)
    expect(r.fetched).toBeGreaterThan(0)
    // Nao continua depois de alcancar a janela pedida: cada rodada e um pedido
    // ao celular do usuario.
    expect(fetchOlderMessages.mock.calls.length).toBeLessThanOrEqual(3)
    expect(getChat(jid)?.syncedFull).toBe(0)
  })

  it('so marca a conversa como completa quando o celular RESPONDE sem nada anterior', async () => {
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    fetchOlderMessages.mockImplementation(async () => {
      setTimeout(() => answer(jid), 5)
      return sent('req-2')
    })

    const r = await syncChatHistory(jid, null)

    expect(r.exhausted).toBe(true)
    expect(r.timedOut).toBe(false)
    expect(r.fetched).toBe(0)
    expect(getChat(jid)?.syncedFull).toBe(1)
  })

  it('celular calado NAO vira "conversa completa"', async () => {
    // Este era o bug: quem responde o pedido de historico e o aparelho pareado.
    // Se ele esta offline, ninguem responde — e a versao anterior concluia que
    // a conversa tinha acabado, marcava como completa com zero mensagens e a
    // tirava da fila para sempre.
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    fetchOlderMessages.mockResolvedValue(sent('req-3'))

    const r = await syncChatHistory(jid, null)

    expect(r.timedOut).toBe(true)
    expect(r.exhausted).toBe(false)
    expect(getChat(jid)?.syncedFull).toBe(0)
  })

  it('nao pede nada sem ancora nem com o WhatsApp desconectado', async () => {
    const semMensagem = freshJid()
    upsertChat(semMensagem, { name: 'vazia' })
    expect((await syncChatHistory(semMensagem, 7)).noAnchor).toBe(true)

    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    socketRef.current = null
    expect((await syncChatHistory(jid, 7)).offline).toBe(true)

    expect(fetchOlderMessages).not.toHaveBeenCalled()
  })

  it('a ancora enviada e a chave do WhatsApp, nao a linha local', async () => {
    // ESTE ERA O BUG. A conversa tem duas linhas: a que o disparo gravou (mais
    // antiga, com relogio local e id sintetico) e a que veio do WhatsApp. Pedir
    // com a primeira manda ao celular um par (id, carimbo) que ele nao resolve
    // — e o aparelho nao responde NADA, nem erro, nem lote vazio.
    const jid = freshJid()
    seedLocal(jid, Date.now() - 10 * DAY)
    seed(jid, Date.now() - 5 * DAY, 'WA-REAL-1')
    fetchOlderMessages.mockResolvedValue(sent('req-anchor'))

    await syncChatHistory(jid, 30)

    const [anchor] = fetchOlderMessages.mock.calls[0] as [
      { id: string; ts: number; fromMe: boolean }
    ]
    expect(anchor.id).toBe('WA-REAL-1')
    // Carimbo do servidor vem em segundos: em ms sempre termina em 000.
    expect(anchor.ts % 1000).toBe(0)
  })

  it('conversa que so tem o que o app enviou fica sem ancora', async () => {
    // Conversa criada pelo disparo: nenhuma linha tem carimbo do servidor nem
    // id do WhatsApp. Antes isso virava um pedido fantasma e 45s de silencio
    // lidos como "o celular esta offline".
    const jid = freshJid()
    seedLocal(jid, Date.now() - DAY)

    const r = await syncChatHistory(jid, 30)

    expect(r.noAnchor).toBe(true)
    expect(r.timedOut).toBe(false)
    expect(fetchOlderMessages).not.toHaveBeenCalled()
  })

  it('lote que chega ANTES do pedido resolver ainda casa', async () => {
    // O lote e emitido no event loop do Baileys e pode chegar enquanto o await
    // do envio ainda esta pendente. Com o ouvinte registrado so depois, essa
    // resposta se perdia e o pedido morria por timeout.
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    const outro = freshJid()
    fetchOlderMessages.mockImplementation(async () => {
      // Fala de OUTRA conversa: so o requestId pode casar isto.
      inboxEvents.emit('historyBatch', {
        requestId: 'req-corrida',
        inserted: {},
        jids: [outro]
      })
      return sent('req-corrida')
    })

    const r = await syncChatHistory(jid, null)

    expect(r.timedOut).toBe(false)
    expect(r.exhausted).toBe(true)
  })

  it('cooldown nao consome rodada', async () => {
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    let tentativas = 0
    fetchOlderMessages.mockImplementation(async () => {
      tentativas += 1
      if (tentativas <= 3) return { sent: false, reason: 'cooldown' }
      setTimeout(() => answer(jid), 5)
      return sent('req-cool')
    })

    const r = await syncChatHistory(jid, null)

    // O pedido chegou a sair depois dos cooldowns: eles nao gastaram as rodadas.
    expect(r.exhausted).toBe(true)
    expect(r.timedOut).toBe(false)
    expect(tentativas).toBe(4)
  })

  it('falha ao enviar o pedido nao vira "celular calado" nem "conversa completa"', async () => {
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    fetchOlderMessages.mockResolvedValue({ sent: false, reason: 'error' })

    const r = await syncChatHistory(jid, null)

    expect(r.requestFailed).toBe(true)
    expect(r.timedOut).toBe(false)
    expect(r.exhausted).toBe(false)
    expect(getChat(jid)?.syncedFull).toBe(0)
  })

  it('pedido sem requestId ainda casa pela conversa', async () => {
    // Nem toda versao do WhatsApp preenche o `peerDataRequestSessionId`.
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    fetchOlderMessages.mockImplementation(async () => {
      setTimeout(() => answer(jid), 5)
      return sent(null)
    })

    const r = await syncChatHistory(jid, null)

    expect(r.exhausted).toBe(true)
    expect(r.timedOut).toBe(false)
  })
})

describe('autoSyncOnOpen', () => {
  it('puxa historico na conversa pouco sincronizada, uma vez por sessao', async () => {
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    setChatSync(jid, { syncedFrom: Date.now() - DAY })
    fetchOlderMessages.mockImplementation(async () => {
      setTimeout(() => answer(jid), 5)
      return sent('req-4')
    })

    expect(await autoSyncOnOpen(jid)).not.toBeNull()
    expect(fetchOlderMessages).toHaveBeenCalled()

    // Reabrir a mesma conversa nao pode virar uma sequencia de requisicoes.
    fetchOlderMessages.mockClear()
    expect(await autoSyncOnOpen(jid)).toBeNull()
    expect(fetchOlderMessages).not.toHaveBeenCalled()
  })

  it('tentativa sem resposta do celular nao queima a vez da conversa', async () => {
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    setChatSync(jid, { syncedFrom: Date.now() - DAY })
    fetchOlderMessages.mockResolvedValue(sent('req-5'))

    expect((await autoSyncOnOpen(jid))?.timedOut).toBe(true)

    // O aparelho pode voltar em um minuto: abrir de novo tenta de novo.
    fetchOlderMessages.mockClear()
    fetchOlderMessages.mockResolvedValue(sent('req-6'))
    expect(await autoSyncOnOpen(jid)).not.toBeNull()
    expect(fetchOlderMessages).toHaveBeenCalled()
  })

  it('nao pede nada quando a conversa ja tem passado suficiente', async () => {
    const jid = freshJid()
    seed(jid, Date.now() - 40 * DAY)
    setChatSync(jid, { syncedFrom: Date.now() - 40 * DAY })

    expect(await autoSyncOnOpen(jid)).toBeNull()
    expect(fetchOlderMessages).not.toHaveBeenCalled()
  })
})
