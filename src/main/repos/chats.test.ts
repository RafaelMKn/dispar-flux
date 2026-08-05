import { describe, it, expect, beforeAll } from 'vitest'
import { initDb } from '../db'
import { createContactList } from './contactLists'
import { insertContacts } from './contacts'
import {
  upsertChat,
  getChat,
  listChats,
  insertMessages,
  refreshLeadFlags,
  countLeadChats,
  repairChatTimestamps,
  clearPhantomChatDates,
  clearUnprovenFullSync,
  setChatSync,
  getChatView,
  leadChatsNeedingFullSync
} from './chats'

beforeAll(async () => {
  await initDb()
})

let counter = 0
function freshJid(): string {
  counter += 1
  return `5511970${String(counter).padStart(6, '0')}@s.whatsapp.net`
}

function phoneOf(jid: string): string {
  return `+${jid.split('@')[0]}`
}

describe('upsertChat e a data da conversa', () => {
  it('nao inventa data para conversa sem mensagem', () => {
    const jid = freshJid()
    upsertChat(jid, { name: 'Sem conversa' })
    expect(getChat(jid)?.lastTs).toBeNull()
  })

  it('usa a data da mensagem, e nao a de agora', () => {
    const jid = freshJid()
    const ts = Date.parse('2025-03-10T12:00:00Z')
    upsertChat(jid, { lastMessage: 'oi', lastTs: ts })
    expect(getChat(jid)?.lastTs).toBe(ts)
  })

  it('mensagem antiga chegando depois nao muda a data nem a previa', () => {
    const jid = freshJid()
    const novo = Date.parse('2026-01-10T12:00:00Z')
    const antigo = Date.parse('2025-01-10T12:00:00Z')
    upsertChat(jid, { lastMessage: 'recente', lastTs: novo })
    upsertChat(jid, { lastMessage: 'antiga', lastTs: antigo })

    const row = getChat(jid)
    expect(row?.lastTs).toBe(novo)
    expect(row?.lastMessage).toBe('recente')
  })

  it('com create: false nao cria conversa nova, mas atualiza a existente', () => {
    const ausente = freshJid()
    upsertChat(ausente, { name: 'Contato da agenda' }, { create: false })
    expect(getChat(ausente)).toBeUndefined()

    const existente = freshJid()
    upsertChat(existente, { lastMessage: 'oi', lastTs: Date.now() })
    upsertChat(existente, { name: 'Maria' }, { create: false })
    expect(getChat(existente)?.name).toBe('Maria')
  })
})

describe('insertMessages', () => {
  it('devolve so as mensagens novas e ignora repetidas', () => {
    const jid = freshJid()
    const base = { chatJid: jid, direction: 'in' as const, body: 'oi', waMessageId: null }

    const first = insertMessages([
      { ...base, id: 'A1', ts: 1 },
      { ...base, id: 'A2', ts: 2 },
      // repetida dentro do proprio lote
      { ...base, id: 'A2', ts: 2 }
    ])
    expect(first.map((m) => m.id).sort()).toEqual(['A1', 'A2'])

    const second = insertMessages([
      { ...base, id: 'A2', ts: 2 },
      { ...base, id: 'A3', ts: 3 }
    ])
    expect(second.map((m) => m.id)).toEqual(['A3'])
  })
})

describe('base de leads', () => {
  it('marca a conversa cujo numero esta na base, mesmo sem o 9o digito', () => {
    const listId = createContactList('Base inbox').id
    const jid = freshJid()
    upsertChat(jid, { lastMessage: 'oi', lastTs: Date.now() })

    const outro = freshJid()
    upsertChat(outro, { lastMessage: 'oi', lastTs: Date.now() })

    insertContacts([{ listId, name: 'Lead', phoneE164: phoneOf(jid), extraJson: null }])
    const antes = countLeadChats()
    refreshLeadFlags()

    expect(countLeadChats()).toBe(antes + 1)
    expect(getChat(jid)?.isLead).toBe(1)
    expect(getChat(outro)?.isLead).toBe(0)
  })

  it('lista so as conversas da base quando pedido', () => {
    const jids = listChats({ onlyLeads: true }).map((c) => c.jid)
    expect(jids.length).toBeGreaterThan(0)
    for (const jid of jids) expect(getChat(jid)?.isLead).toBe(1)
  })

  it('fila de sincronizacao completa ignora quem ja esta completo', () => {
    const pendentes = leadChatsNeedingFullSync()
    expect(pendentes.length).toBeGreaterThan(0)

    setChatSync(pendentes[0], { syncedFull: true })
    expect(leadChatsNeedingFullSync()).not.toContain(pendentes[0])
    expect(getChatView(pendentes[0])?.syncedFull).toBe(true)
  })
})

describe('listChats', () => {
  it('respeita o teto pedido', () => {
    expect(listChats({ limit: 2 }).length).toBeLessThanOrEqual(2)
  })

  it('busca por nome, previa e numero no banco', () => {
    const jid = freshJid()
    upsertChat(jid, { name: 'Joana Pereira', lastMessage: 'orcamento enviado', lastTs: Date.now() })

    expect(listChats({ search: 'joana' }).map((c) => c.jid)).toContain(jid)
    expect(listChats({ search: 'orcamento' }).map((c) => c.jid)).toContain(jid)
    expect(listChats({ search: jid.split('@')[0].slice(-8) }).map((c) => c.jid)).toContain(jid)
    expect(listChats({ search: 'nao existe nada assim' })).toEqual([])
  })

  it('conversa sem data vai para o fim, nao para o topo', () => {
    const semData = freshJid()
    upsertChat(semData, { name: 'Sem historico' })
    const jids = listChats({ limit: 500 }).map((c) => c.jid)
    expect(jids[jids.length - 1]).toBe(semData)
  })
})

describe('conserto das datas herdadas', () => {
  it('realinha a data da conversa com a mensagem mais recente', () => {
    const jid = freshJid()
    const real = Date.parse('2025-06-01T10:00:00Z')
    insertMessages([
      { id: `R${counter}`, chatJid: jid, direction: 'in', body: 'oi', ts: real, waMessageId: null }
    ])
    // Simula o estrago da versao anterior: conversa carimbada com "agora".
    upsertChat(jid, { lastTs: Date.now() })
    expect(getChat(jid)?.lastTs).toBeGreaterThan(real)

    expect(repairChatTimestamps()).toBeGreaterThan(0)
    expect(getChat(jid)?.lastTs).toBe(real)
    // Idempotente: rodar de novo nao acha mais nada.
    expect(repairChatTimestamps()).toBe(0)
  })

  it('devolve para a fila as conversas marcadas como completas sem prova', () => {
    // A versao anterior tratava silencio do celular como fim do historico e
    // marcava a conversa como completa — muitas vezes com zero mensagens.
    const jid = freshJid()
    upsertChat(jid, { lastMessage: 'oi', lastTs: Date.now() })
    setChatSync(jid, { syncedFull: true })

    expect(clearUnprovenFullSync()).toBeGreaterThan(0)
    expect(getChat(jid)?.syncedFull).toBe(0)
    expect(clearUnprovenFullSync()).toBe(0)
  })

  it('apaga a data inventada de conversa que nunca teve mensagem', () => {
    const jid = freshJid()
    upsertChat(jid, { lastMessage: 'fantasma', lastTs: Date.now() })

    expect(clearPhantomChatDates()).toBeGreaterThan(0)
    const row = getChat(jid)
    expect(row?.lastTs).toBeNull()
    expect(row?.lastMessage).toBeNull()
    expect(clearPhantomChatDates()).toBe(0)
  })
})
