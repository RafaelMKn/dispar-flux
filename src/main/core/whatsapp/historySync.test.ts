import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { initDb } from '../../db'

/**
 * O cliente do WhatsApp e trocado por um dublê: o que interessa testar aqui e a
 * DISCIPLINA da sincronizacao (pedir, esperar a resposta, parar quando nao vem
 * mais nada), nao o Baileys.
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
import { insertMessages, upsertChat, getChat, setChatSync } from '../../repos/chats'

beforeAll(async () => {
  await initDb()
})

beforeEach(() => {
  fetchOlderMessages.mockReset()
  socketRef.current = socket
  resetAutoSync()
  // Tempos de teste: o que importa e a sequencia de pedidos, nao a espera real.
  timings.roundTimeoutMs = 120
  timings.pollMs = 20
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

describe('syncChatHistory', () => {
  it('pede lotes ate alcancar a janela de dias e para ali', async () => {
    const jid = freshJid()
    seed(jid, Date.now() - DAY)

    // Cada pedido "traz" mais um dia de passado, como o WhatsApp faria.
    let dias = 1
    fetchOlderMessages.mockImplementation(async () => {
      dias += 3
      seed(jid, Date.now() - dias * DAY)
      return true
    })

    const r = await syncChatHistory(jid, 7)

    expect(r.reachedTarget).toBe(true)
    expect(r.exhausted).toBe(false)
    expect(r.fetched).toBeGreaterThan(0)
    // Nao continua depois de alcancar a janela pedida: cada rodada e uma
    // requisicao ao servidor do WhatsApp.
    expect(fetchOlderMessages.mock.calls.length).toBeLessThanOrEqual(3)
    expect(getChat(jid)?.syncedFull).toBe(0)
  })

  it('para quando o WhatsApp nao tem mais passado, e marca a conversa completa', async () => {
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    // Responde "ok" mas nao entrega nada: e assim que o fim do historico
    // aparece na pratica.
    fetchOlderMessages.mockResolvedValue(true)

    const r = await syncChatHistory(jid, null)

    expect(r.exhausted).toBe(true)
    expect(r.fetched).toBe(0)
    expect(getChat(jid)?.syncedFull).toBe(1)
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
  it('puxa 7 dias na conversa pouco sincronizada, uma vez por sessao', async () => {
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    setChatSync(jid, { syncedFrom: Date.now() - DAY })
    fetchOlderMessages.mockResolvedValue(true)

    expect(await autoSyncOnOpen(jid)).not.toBeNull()
    expect(fetchOlderMessages).toHaveBeenCalled()

    // Reabrir a mesma conversa nao pode virar uma sequencia de requisicoes.
    fetchOlderMessages.mockClear()
    expect(await autoSyncOnOpen(jid)).toBeNull()
    expect(fetchOlderMessages).not.toHaveBeenCalled()
  })

  it('nao pede nada quando a conversa ja tem passado suficiente', async () => {
    const jid = freshJid()
    seed(jid, Date.now() - 40 * DAY)
    setChatSync(jid, { syncedFrom: Date.now() - 40 * DAY })

    expect(await autoSyncOnOpen(jid)).toBeNull()
    expect(fetchOlderMessages).not.toHaveBeenCalled()
  })
})
