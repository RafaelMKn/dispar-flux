import { describe, it, expect, beforeAll } from 'vitest'
import { initDb } from '../db'
import { createContactList } from './contactLists'
import { insertContacts } from './contacts'
import {
  upsertChat,
  getChat,
  listChats,
  insertMessage,
  insertMessages,
  countMessages,
  oldestMessage,
  oldestAnchor,
  backfillServerTimestamps,
  refreshLeadFlags,
  countLeadChats,
  repairChatTimestamps,
  clearPhantomChatDates,
  clearUnprovenFullSync,
  setChatSync,
  getChatView,
  leadChatsNeedingFullSync,
  mergeLidChats
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

  it('o eco do Baileys corrige o carimbo da linha gravada no envio', () => {
    // O app grava o proprio envio na hora, com o relogio da maquina, para a
    // mensagem nao ficar segundos sumida da tela. O eco chega depois com o
    // carimbo de verdade — e ate aqui era descartado pela idempotencia,
    // deixando um `ts` que o celular nunca viu servir de ancora.
    const jid = freshJid()
    const local = Date.now()
    insertMessage({
      id: 'ECO-1',
      chatJid: jid,
      direction: 'out',
      body: 'oi',
      ts: local,
      waMessageId: 'ECO-1'
    })
    expect(oldestAnchor(jid)).toBeNull()

    const doServidor = Math.floor(local / 1000) * 1000
    const novas = insertMessages([
      {
        id: 'ECO-1',
        chatJid: jid,
        direction: 'out',
        body: 'oi',
        ts: doServidor,
        waTs: doServidor,
        waMessageId: 'ECO-1'
      }
    ])

    // Correcao de carimbo NAO e mensagem nova: se entrasse no retorno, o
    // `afterInsert` rodaria de novo (nao-lidas, opt-out, CRM, download).
    expect(novas).toEqual([])
    expect(countMessages(jid)).toBe(1)
    expect(oldestAnchor(jid)?.ts).toBe(doServidor)
  })

  it('nao mexe na linha que ja tem carimbo do servidor', () => {
    const jid = freshJid()
    const base = { chatJid: jid, direction: 'in' as const, body: 'oi', waMessageId: 'FIX-1' }
    insertMessages([{ ...base, id: 'FIX-1', ts: 10_000, waTs: 10_000 }])

    insertMessages([{ ...base, id: 'FIX-1', ts: 99_000, waTs: 99_000 }])

    expect(oldestAnchor(jid)?.ts).toBe(10_000)
  })
})

describe('ancora do pedido de historico', () => {
  const base = { direction: 'in' as const, body: 'oi' }

  it('ignora a linha sem carimbo do servidor, mesmo sendo a mais antiga', () => {
    const jid = freshJid()
    // Gravada pelo disparo: relogio local, id sintetico.
    insertMessages([
      { ...base, id: 'L1', chatJid: jid, direction: 'out', ts: 1_000_500, waMessageId: null }
    ])
    insertMessages([
      { ...base, id: 'W1', chatJid: jid, ts: 5_000_000, waTs: 5_000_000, waMessageId: 'W1' }
    ])

    // `oldestMessage` continua vendo a mais antiga de verdade (bookkeeping do
    // `syncedFrom`); a ancora, nao.
    expect(oldestMessage(jid)?.id).toBe('L1')
    expect(oldestAnchor(jid)?.id).toBe('W1')
  })

  it('ignora a linha com carimbo mas sem id do WhatsApp', () => {
    const jid = freshJid()
    insertMessages([
      { ...base, id: 'local-9', chatJid: jid, ts: 2_000_000, waTs: 2_000_000, waMessageId: null }
    ])
    expect(oldestAnchor(jid)).toBeNull()
  })

  it('devolve o id do WhatsApp e o carimbo do servidor, nao os da linha', () => {
    const jid = freshJid()
    insertMessages([
      {
        ...base,
        id: 'linha-interna',
        chatJid: jid,
        ts: 7_777_777,
        waTs: 7_000_000,
        waMessageId: 'WA-XYZ'
      }
    ])
    const anchor = oldestAnchor(jid)
    expect(anchor?.id).toBe('WA-XYZ')
    expect(anchor?.ts).toBe(7_000_000)
    expect(anchor?.remoteJid).toBe(jid)
  })

  it('a fila de leads pula conversa sem ancora', () => {
    const listId = createContactList('Base ancora').id
    const semAncora = freshJid()
    const comAncora = freshJid()
    for (const jid of [semAncora, comAncora]) {
      upsertChat(jid, { lastMessage: 'oi', lastTs: Date.now() })
    }
    insertContacts([
      { listId, name: 'Sem ancora', phoneE164: phoneOf(semAncora), extraJson: null },
      { listId, name: 'Com ancora', phoneE164: phoneOf(comAncora), extraJson: null }
    ])
    refreshLeadFlags()

    insertMessages([
      { ...base, id: 'SA1', chatJid: semAncora, direction: 'out', ts: 3_000_123, waMessageId: null }
    ])
    insertMessages([
      { ...base, id: 'CA1', chatJid: comAncora, ts: 3_000_000, waTs: 3_000_000, waMessageId: 'CA1' }
    ])

    const fila = leadChatsNeedingFullSync(100)
    expect(fila).toContain(comAncora)
    expect(fila).not.toContain(semAncora)
  })
})

describe('backfillServerTimestamps', () => {
  it('adota o carimbo so onde da para provar a origem, e roda uma vez', () => {
    const jid = freshJid()
    const base = { chatJid: jid, direction: 'in' as const, body: 'oi' }
    insertMessages([
      // Segundo redondo + id do WhatsApp: com certeza veio do servidor.
      { ...base, id: 'B1', ts: 4_000_000, waMessageId: 'B1' },
      // Fracao de ms: com certeza saiu do nosso relogio.
      { ...base, id: 'B2', ts: 4_000_777, waMessageId: 'B2' },
      // Segundo redondo, mas sem id do WhatsApp: o celular nao acharia.
      { ...base, id: 'local-B3', ts: 4_000_000, waMessageId: null }
    ])

    expect(backfillServerTimestamps()).toBeGreaterThan(0)
    expect(oldestAnchor(jid)?.id).toBe('B1')

    // Idempotente: nao sobra nada para uma segunda passada.
    expect(backfillServerTimestamps()).toBe(0)
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
    // A fila so lista quem tem ancora — sem ela nao ha o que pedir ao celular.
    const jid = freshJid()
    upsertChat(jid, { lastMessage: 'oi', lastTs: Date.now() })
    const listId = createContactList('Base fila').id
    insertContacts([{ listId, name: 'Lead', phoneE164: phoneOf(jid), extraJson: null }])
    refreshLeadFlags()
    insertMessages([
      {
        id: 'FILA-1',
        chatJid: jid,
        direction: 'in',
        body: 'oi',
        ts: 6_000_000,
        waTs: 6_000_000,
        waMessageId: 'FILA-1'
      }
    ])

    const pendentes = leadChatsNeedingFullSync()
    expect(pendentes).toContain(jid)

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

describe('mergeLidChats', () => {
  it('junta as duas conversas sem duplicar mensagem e guarda o endereco de protocolo', () => {
    /**
     * O estrago que o usuario via: 46 conversas duplicadas na inbox. A mesma
     * pessoa com duas linhas — a que o disparo criou pelo numero e a que a
     * resposta dela criou pelo LID.
     */
    const pn = freshJid()
    const lid = '71700301529149@lid'

    upsertChat(pn, { lastMessage: 'do disparo', lastTs: 1_000_000 })
    insertMessages([
      { id: 'PN-1', chatJid: pn, direction: 'out', body: 'oi', ts: 1_000_000, waMessageId: 'PN-1' }
    ])
    upsertChat(lid, { lastMessage: 'resposta', lastTs: 2_000_000 })
    insertMessages([
      {
        id: 'LID-1',
        chatJid: lid,
        direction: 'in',
        body: 'oi de volta',
        ts: 2_000_000,
        waMessageId: 'LID-1'
      }
    ])

    expect(mergeLidChats([{ lid, jid: pn }])).toBe(1)

    expect(getChat(lid)).toBeUndefined()
    expect(countMessages(pn)).toBe(2)
    // O endereco de protocolo e preservado: e por ele que o pedido de historico
    // e o recibo de leitura precisam sair.
    expect(getChat(pn)?.lid).toBe(lid)
  })

  it('preserva o passado MAIS ANTIGO dos dois lados', () => {
    const pn = freshJid()
    const lid = '71700301529150@lid'
    upsertChat(pn, { lastTs: 1_000_000 })
    setChatSync(pn, { syncedFrom: 5_000_000 })
    upsertChat(lid, { lastTs: 2_000_000 })
    setChatSync(lid, { syncedFrom: 1_000_000 })

    mergeLidChats([{ lid, jid: pn }])

    // Perder isso faria a conversa pedir de novo um passado que ja temos.
    expect(getChat(pn)?.syncedFrom).toBe(1_000_000)
  })

  it('"completa" so sobrevive se AMBOS os lados provaram estar completos', () => {
    const pn = freshJid()
    const lid = '71700301529151@lid'
    upsertChat(pn, { lastTs: 1 })
    setChatSync(pn, { syncedFrom: 1, syncedFull: true })
    upsertChat(lid, { lastTs: 2 })
    setChatSync(lid, { syncedFrom: 1, syncedFull: false })

    mergeLidChats([{ lid, jid: pn }])

    expect(getChat(pn)?.syncedFull).toBe(0)
  })

  it('sem conversa pelo telefone, a propria linha vira a canonica', () => {
    const pn = freshJid()
    const lid = '71700301529152@lid'
    upsertChat(lid, { lastMessage: 'oi', lastTs: 3_000_000 })
    insertMessages([
      {
        id: 'SO-LID-1',
        chatJid: lid,
        direction: 'in',
        body: 'oi',
        ts: 3_000_000,
        waMessageId: 'SO-LID-1'
      }
    ])

    expect(mergeLidChats([{ lid, jid: pn }])).toBe(1)

    expect(getChat(lid)).toBeUndefined()
    expect(getChat(pn)?.lid).toBe(lid)
    expect(countMessages(pn)).toBe(1)
  })

  it('nao faz nada quando nao ha conversa LID para fundir', () => {
    expect(mergeLidChats([{ lid: '99999999999999@lid', jid: freshJid() }])).toBe(0)
    expect(mergeLidChats([])).toBe(0)
  })
})

describe('mergeLidChats — sufixo de dispositivo', () => {
  it('funde as DUAS formas do mesmo LID na mesma conversa do telefone', () => {
    /**
     * `x@lid` e `x:23@lid` sao a mesma pessoa. Antes, comparando por igualdade
     * crua, a segunda forma nunca casava e ficava para sempre como uma terceira
     * conversa na inbox.
     */
    const pn = freshJid()
    const base = '88800000000001@lid'
    const comDispositivo = '88800000000001:23@lid'

    upsertChat(pn, { lastMessage: 'do disparo', lastTs: 1_000 })
    insertMessages([
      { id: 'D-PN', chatJid: pn, direction: 'out', body: 'oi', ts: 1_000, waMessageId: 'D-PN' }
    ])
    upsertChat(base, { lastTs: 2_000 })
    insertMessages([
      { id: 'D-BASE', chatJid: base, direction: 'in', body: 'a', ts: 2_000, waMessageId: 'D-BASE' }
    ])
    upsertChat(comDispositivo, { lastTs: 3_000 })
    insertMessages([
      {
        id: 'D-DEV',
        chatJid: comDispositivo,
        direction: 'in',
        body: 'b',
        ts: 3_000,
        waMessageId: 'D-DEV'
      }
    ])

    expect(
      mergeLidChats([
        { lid: base, jid: pn },
        { lid: comDispositivo, jid: pn }
      ])
    ).toBe(2)

    expect(getChat(base)).toBeUndefined()
    expect(getChat(comDispositivo)).toBeUndefined()
    expect(countMessages(pn)).toBe(3)
  })

  it('rodar o merge duas vezes nao duplica nem perde mensagem', () => {
    // Ele roda no boot E ao fim da varredura de LID: precisa ser idempotente.
    const pn = freshJid()
    const lid = '88800000000002@lid'
    upsertChat(pn, { lastTs: 1_000 })
    upsertChat(lid, { lastTs: 2_000 })
    insertMessages([
      { id: 'IDEM-1', chatJid: lid, direction: 'in', body: 'x', ts: 2_000, waMessageId: 'IDEM-1' }
    ])

    expect(mergeLidChats([{ lid, jid: pn }])).toBe(1)
    expect(mergeLidChats([{ lid, jid: pn }])).toBe(0)
    expect(countMessages(pn)).toBe(1)
  })
})
