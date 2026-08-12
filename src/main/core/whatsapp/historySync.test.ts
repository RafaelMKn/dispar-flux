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

import {
  syncChatHistory,
  syncLeadChats,
  autoSyncOnOpen,
  resetAutoSync,
  timings
} from './historySync'
import { resetRequests, pendingFor, recentRequests } from './historyRequests'
import { inboxEvents } from './inbox'
import { insertMessages, upsertChat, getChat, setChatSync } from '../../repos/chats'
import { insertContacts } from '../../repos/contacts'

beforeAll(async () => {
  await initDb()
})

beforeEach(() => {
  fetchOlderMessages.mockReset()
  socketRef.current = socket
  resetAutoSync()
  resetRequests()
  // Tempos de teste: o que importa e a sequencia de pedidos, nao a espera real.
  timings.roundWaitMs = 150
  timings.queueWaitMs = 150
  timings.leadQueueWaitMs = 150
  timings.requestTtlMs = 10_000
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
function answer(jid: string, opts: { withOlder?: number; requestId?: string | null } = {}): void {
  if (opts.withOlder) seed(jid, opts.withOlder)
  inboxEvents.emit('historyBatch', {
    requestId: opts.requestId ?? null,
    inserted: {},
    jids: [jid]
  })
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

    expect(r.outcome).toBe('reachedTarget')
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

    expect(r.outcome).toBe('exhausted')
    expect(r.fetched).toBe(0)
    expect(getChat(jid)?.syncedFull).toBe(1)
  })

  it('celular calado NAO vira "conversa completa" nem acusa o aparelho', async () => {
    // Este era o bug original: quem responde o pedido e o aparelho pareado. Se
    // ele demora, a versao antiga concluia que a conversa tinha acabado. Hoje o
    // desfecho e `awaitingPhone` — que a tela traduz como "ainda nao chegou",
    // nao como "o celular parou de responder" — e o pedido segue aberto.
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    fetchOlderMessages.mockResolvedValue(sent('req-3'))

    const r = await syncChatHistory(jid, null)

    expect(r.outcome).toBe('awaitingPhone')
    expect(r.pendingRequests).toBe(1)
    expect(getChat(jid)?.syncedFull).toBe(0)
  })

  it('nao pede nada sem ancora nem com o WhatsApp desconectado', async () => {
    const semMensagem = freshJid()
    upsertChat(semMensagem, { name: 'vazia' })
    expect((await syncChatHistory(semMensagem, 7)).outcome).toBe('noAnchor')

    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    socketRef.current = null
    expect((await syncChatHistory(jid, 7)).outcome).toBe('offline')

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
    // id do WhatsApp. Antes isso virava um pedido fantasma e um silencio longo
    // lido como "o celular esta offline".
    const jid = freshJid()
    seedLocal(jid, Date.now() - DAY)

    const r = await syncChatHistory(jid, 30)

    expect(r.outcome).toBe('noAnchor')
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

    expect(r.outcome).toBe('exhausted')
  })

  it('fila ocupada nao vira "o celular parou de responder" nem carimba a conversa', async () => {
    /**
     * A CAUSA EXATA DA RECLAMACAO. Quando a vaga de envio estava tomada, a
     * versao anterior saia do laco sem marcar nada: a tela dizia "nada novo veio
     * desta vez" e o `setChatSync` ainda gravava `syncedFrom`, deixando a
     * conversa com cara de sincronizada sem nenhum pedido ter saido.
     */
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    const antes = getChat(jid)?.syncedFrom ?? null
    fetchOlderMessages.mockResolvedValue({ sent: false, reason: 'busy' })

    const r = await syncChatHistory(jid, null)

    expect(r.outcome).toBe('busy')
    expect(getChat(jid)?.syncedFrom ?? null).toBe(antes)
    expect(getChat(jid)?.syncedFull).toBe(0)
    // E nenhum pedido foi registrado: nao houve o que o celular responder.
    expect(pendingFor(jid)).toHaveLength(0)
  })

  it('falha ao enviar o pedido nao vira "celular calado" nem "conversa completa"', async () => {
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    const antes = getChat(jid)?.syncedFrom ?? null
    fetchOlderMessages.mockResolvedValue({ sent: false, reason: 'error' })

    const r = await syncChatHistory(jid, null)

    expect(r.outcome).toBe('requestFailed')
    expect(getChat(jid)?.syncedFrom ?? null).toBe(antes)
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

    expect(r.outcome).toBe('exhausted')
  })

  it('resposta que chega DEPOIS do retorno ainda e creditada', async () => {
    /**
     * A tese da mudanca. O aparelho monta e sobe o pacote de historico quando
     * consegue — as vezes minutos depois. Antes o ouvinte morria junto com a
     * rodada, entao esse lote atrasado nao era creditado a lugar nenhum e o
     * usuario tinha que clicar de novo.
     */
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    fetchOlderMessages.mockResolvedValue(sent('req-tardio'))

    const r = await syncChatHistory(jid, null)
    expect(r.outcome).toBe('awaitingPhone')
    expect(pendingFor(jid)).toHaveLength(1)

    const tardios: unknown[] = []
    inboxEvents.on('historyLate', (p) => tardios.push(p))

    // O celular responde depois que ninguem mais estava esperando.
    seed(jid, Date.now() - 30 * DAY)
    answer(jid, { requestId: 'req-tardio' })

    expect(pendingFor(jid)).toHaveLength(0)
    expect(recentRequests()[0].status).toBe('respondido')
    // E a conversa aprendeu o passado novo, sem novo clique.
    expect(getChat(jid)?.syncedFrom).toBeLessThan(Date.now() - 29 * DAY)
    expect(tardios).toHaveLength(1)
  })
})

describe('syncLeadChats', () => {
  /**
   * Conversa que entra na fila de leads.
   *
   * `is_lead` e derivado da base de contatos por `refreshLeadFlags`, entao nao
   * adianta escrever a flag na conversa: ela seria sobrescrita na hora.
   */
  function seedLead(): string {
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    insertContacts([
      {
        listId: 'lista-teste',
        name: 'Lead',
        phoneE164: `+${jid.split('@')[0]}`,
        extraJson: null
      }
    ])
    return jid
  }

  it('falha de envio e reportada como falha de envio, nao como celular calado', async () => {
    /**
     * A CAUSA 3 DENTRO DA FILA. Antes, `requestFailed` e "sem resposta" caiam
     * no mesmo `stalled: boolean`, e o banner dizia que o celular tinha parado
     * de responder mesmo quando o pedido nao havia saido daqui.
     */
    seedLead()
    fetchOlderMessages.mockResolvedValue({ sent: false, reason: 'error' })

    const s = await syncLeadChats(5)

    expect(s.stoppedReason).toBe('requestFailed')
  })

  it('silencio do aparelho para a fila com o motivo certo', async () => {
    seedLead()
    fetchOlderMessages.mockResolvedValue(sent('req-fila'))

    const s = await syncLeadChats(5)

    expect(s.stoppedReason).toBe('phoneQuiet')
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

  it('reabrir a conversa nao empilha pedido em cima de um que ainda esta de pe', async () => {
    /**
     * O aparelho ja esta montando o pacote. Antes, "sem resposta no prazo"
     * liberava a conversa para pedir de novo, entao cada reabertura somava mais
     * um pedido — justamente o padrao de rajada que o resto do modulo evita.
     */
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    setChatSync(jid, { syncedFrom: Date.now() - DAY })
    fetchOlderMessages.mockResolvedValue(sent('req-5'))

    expect((await autoSyncOnOpen(jid))?.outcome).toBe('awaitingPhone')

    fetchOlderMessages.mockClear()
    expect(await autoSyncOnOpen(jid)).toBeNull()
    expect(fetchOlderMessages).not.toHaveBeenCalled()
  })

  it('quando nada saiu daqui, a proxima abertura tenta de novo', async () => {
    const jid = freshJid()
    seed(jid, Date.now() - DAY)
    setChatSync(jid, { syncedFrom: Date.now() - DAY })
    fetchOlderMessages.mockResolvedValue({ sent: false, reason: 'busy' })

    expect((await autoSyncOnOpen(jid))?.outcome).toBe('busy')

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
