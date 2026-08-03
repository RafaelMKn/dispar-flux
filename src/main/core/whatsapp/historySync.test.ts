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

function seed(jid: string, ts: number, id = `S${(counter += 1)}`): void {
  insertMessages([{ id, chatJid: jid, direction: 'in', body: 'oi', ts, waMessageId: null }])
  upsertChat(jid, { lastMessage: 'oi', lastTs: ts })
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
      return 'req-1'
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
      return 'req-2'
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
    fetchOlderMessages.mockResolvedValue('req-3')

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
})

describe('autoSyncOnOpen', () => {
  it('puxa historico na conversa pouco sincronizada, uma vez por sessao', async () => {
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    setChatSync(jid, { syncedFrom: Date.now() - DAY })
    fetchOlderMessages.mockImplementation(async () => {
      setTimeout(() => answer(jid), 5)
      return 'req-4'
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
    fetchOlderMessages.mockResolvedValue('req-5')

    expect((await autoSyncOnOpen(jid))?.timedOut).toBe(true)

    // O aparelho pode voltar em um minuto: abrir de novo tenta de novo.
    fetchOlderMessages.mockClear()
    fetchOlderMessages.mockResolvedValue('req-6')
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
