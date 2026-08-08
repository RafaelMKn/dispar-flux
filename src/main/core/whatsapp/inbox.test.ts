import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { initDb } from '../../db'
import {
  extractText,
  describeMedia,
  previewLabel,
  mapStatus,
  handleUpsert,
  handleHistorySet,
  handleMessagesUpdate,
  handleContacts,
  setMediaBridge,
  inboxEvents,
  getHistorySyncState,
  resetHistorySyncState,
  historySyncTypeName
} from './inbox'
import {
  listChats,
  listMessages,
  getMessage,
  getChat,
  countMessages,
  oldestMessage
} from '../../repos/chats'
import { getOptOutSet } from '../../repos/optOuts'

beforeAll(async () => {
  await initDb()
})

beforeEach(() => {
  setMediaBridge(null)
  inboxEvents.removeAllListeners()
})

let counter = 0
/** Cada teste usa um JID proprio: o banco de teste e compartilhado no arquivo. */
function freshJid(): string {
  counter += 1
  return `5511900${String(counter).padStart(6, '0')}@s.whatsapp.net`
}

function incoming(jid: string, message: unknown, extra: Record<string, unknown> = {}): unknown {
  counter += 1
  return {
    key: { id: `MSG${counter}`, remoteJid: jid, fromMe: false },
    message,
    messageTimestamp: 1_700_000_000,
    ...extra
  }
}

describe('extractText', () => {
  it('le texto simples e texto estendido', () => {
    expect(extractText({ conversation: 'oi' })).toBe('oi')
    expect(extractText({ extendedTextMessage: { text: 'link' } })).toBe('link')
  })

  it('atravessa mensagem temporaria e de visualizacao unica', () => {
    expect(extractText({ ephemeralMessage: { message: { conversation: 'some' } } })).toBe('some')
    expect(
      extractText({ viewOnceMessageV2: { message: { imageMessage: { caption: 'olha' } } } })
    ).toBe('olha')
  })

  it('devolve a legenda da midia, e null quando nao ha texto nenhum', () => {
    expect(extractText({ imageMessage: { caption: 'foto do produto' } })).toBe('foto do produto')
    expect(extractText({ imageMessage: {} })).toBeNull()
    expect(extractText({ reactionMessage: {} } as never)).toBeNull()
  })
})

describe('describeMedia', () => {
  it('descreve imagem, documento e nota de voz', () => {
    expect(describeMedia({ imageMessage: { mimetype: 'image/jpeg', fileLength: 1234 } })).toEqual({
      kind: 'image',
      mime: 'image/jpeg',
      name: null,
      size: 1234,
      seconds: null,
      ptt: false
    })

    expect(
      describeMedia({
        documentMessage: { mimetype: 'application/pdf', fileName: 'proposta.pdf' }
      })
    ).toMatchObject({ kind: 'document', name: 'proposta.pdf' })

    expect(
      describeMedia({ audioMessage: { mimetype: 'audio/ogg', seconds: 7, ptt: true } })
    ).toMatchObject({ kind: 'audio', seconds: 7, ptt: true })
  })

  it('converte fileLength em Long para numero', () => {
    const media = describeMedia({ videoMessage: { fileLength: { toNumber: () => 999 } } })
    expect(media?.size).toBe(999)
  })

  it('devolve null para mensagem so de texto', () => {
    expect(describeMedia({ conversation: 'oi' })).toBeNull()
  })

  it('enxerga a midia dentro do documento-com-legenda', () => {
    const media = describeMedia({
      documentWithCaptionMessage: {
        message: { documentMessage: { fileName: 'contrato.pdf', caption: 'segue' } }
      }
    })
    expect(media).toMatchObject({ kind: 'document', name: 'contrato.pdf' })
  })
})

describe('previewLabel', () => {
  it('prefere o texto e, sem ele, rotula o tipo de anexo', () => {
    expect(previewLabel(null, 'oi')).toBe('oi')
    expect(
      previewLabel(
        { kind: 'image', mime: null, name: null, size: null, seconds: null, ptt: false },
        null
      )
    ).toBe('[imagem]')
    expect(
      previewLabel(
        { kind: 'audio', mime: null, name: null, size: null, seconds: null, ptt: true },
        null
      )
    ).toBe('[audio]')
    expect(
      previewLabel(
        { kind: 'document', mime: null, name: 'nota.pdf', size: null, seconds: null, ptt: false },
        null
      )
    ).toBe('[documento: nota.pdf]')
    // Legenda ganha do rotulo.
    expect(
      previewLabel(
        { kind: 'image', mime: null, name: null, size: null, seconds: null, ptt: false },
        'olha isso'
      )
    ).toBe('olha isso')
  })
})

describe('mapStatus', () => {
  it('traduz o enum do Baileys', () => {
    expect(mapStatus(2)).toBe('sent')
    expect(mapStatus(3)).toBe('delivered')
    expect(mapStatus(4)).toBe('read')
    expect(mapStatus(5)).toBe('read') // PLAYED tambem e lido
    expect(mapStatus(0)).toBe('error')
    expect(mapStatus(undefined)).toBeNull()
  })
})

describe('handleUpsert', () => {
  it('guarda mensagem de texto, conta nao lida e atualiza a previa da conversa', () => {
    const jid = freshJid()
    handleUpsert([incoming(jid, { conversation: 'bom dia' }, { pushName: 'Ana' })] as never)

    const msgs = listMessages(jid)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({ body: 'bom dia', direction: 'in', mediaKind: null })

    const chat = listChats().find((c) => c.jid === jid)
    expect(chat).toMatchObject({ name: 'Ana', lastMessage: 'bom dia', unread: 1 })
  })

  it('nao duplica quando o Baileys reemite a mesma mensagem', () => {
    const jid = freshJid()
    const msg = incoming(jid, { conversation: 'oi' })
    handleUpsert([msg] as never)
    handleUpsert([msg] as never)

    expect(listMessages(jid)).toHaveLength(1)
    expect(listChats().find((c) => c.jid === jid)?.unread).toBe(1)
  })

  it('ignora grupos, status e newsletters', () => {
    for (const jid of ['x@g.us', 'status@broadcast', 'y@newsletter']) {
      handleUpsert([incoming(jid, { conversation: 'ruido' })] as never)
      expect(listMessages(jid)).toHaveLength(0)
    }
  })

  it('registra opt-out global quando o contato responde SAIR', () => {
    const jid = freshJid()
    handleUpsert([incoming(jid, { conversation: 'SAIR' })] as never)
    expect(getOptOutSet().has(`+${jid.split('@')[0]}`)).toBe(true)
  })

  it('guarda a midia como pendente e baixa sozinho o que e pequeno', async () => {
    const jid = freshJid()
    const download = vi.fn().mockResolvedValue({ data: Buffer.from('imagem'), mime: 'image/jpeg' })
    setMediaBridge({ encode: () => 'RAW', download })

    handleUpsert([
      incoming(jid, { imageMessage: { mimetype: 'image/jpeg', fileLength: 2048 } })
    ] as never)

    const [msg] = listMessages(jid)
    expect(msg.mediaKind).toBe('image')
    // O download comeca em background; esperamos ele assentar.
    await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => {
      const updated = getMessage(msg.id)
      expect(updated?.mediaState).toBe('done')
      expect(updated?.mediaUrl).toMatch(/^disparmedia:\/\/media\//)
    })
  })

  it('nao baixa sozinho video nem documento', async () => {
    const jid = freshJid()
    const download = vi.fn().mockResolvedValue({ data: Buffer.from('x'), mime: null })
    setMediaBridge({ encode: () => 'RAW', download })

    handleUpsert([
      incoming(jid, { videoMessage: { mimetype: 'video/mp4', fileLength: 5_000_000 } })
    ] as never)
    handleUpsert([
      incoming(jid, { documentMessage: { mimetype: 'application/pdf', fileName: 'a.pdf' } })
    ] as never)

    await new Promise((r) => setTimeout(r, 20))
    expect(download).not.toHaveBeenCalled()
    expect(listMessages(jid).map((m) => m.mediaState)).toEqual(['pending', 'pending'])
  })

  it('nao baixa sozinho um anexo pequeno-mas-gigante', async () => {
    const jid = freshJid()
    const download = vi.fn().mockResolvedValue({ data: Buffer.from('x'), mime: null })
    setMediaBridge({ encode: () => 'RAW', download })

    handleUpsert([
      incoming(jid, { imageMessage: { mimetype: 'image/png', fileLength: 64 * 1024 * 1024 } })
    ] as never)

    await new Promise((r) => setTimeout(r, 20))
    expect(download).not.toHaveBeenCalled()
  })

  it('nao baixa sozinho anexo que veio do historico', async () => {
    const jid = freshJid()
    const download = vi.fn().mockResolvedValue({ data: Buffer.from('x'), mime: 'image/jpeg' })
    setMediaBridge({ encode: () => 'RAW', download })

    // Mesma imagem pequena que baixaria sozinha se fosse ao vivo.
    handleUpsert(
      [incoming(jid, { imageMessage: { mimetype: 'image/jpeg', fileLength: 2048 } })] as never,
      { history: true }
    )

    await new Promise((r) => setTimeout(r, 20))
    // Com o historico completo ligado, baixar cada anexo antigo seriam varios
    // GB no pareamento. Fica pendente e baixa quando o usuario clicar.
    expect(download).not.toHaveBeenCalled()
    expect(listMessages(jid)[0].mediaState).toBe('pending')
  })
})

describe('handleHistorySet', () => {
  it('preenche conversa antiga sem marcar como nao lida nem disparar opt-out', () => {
    const jid = freshJid()
    handleHistorySet({
      chats: [{ id: jid, name: 'Cliente Antigo', conversationTimestamp: 1_600_000_000 }],
      contacts: [],
      messages: [incoming(jid, { conversation: 'SAIR' })]
    } as never)

    expect(listMessages(jid)).toHaveLength(1)
    // Historico nao pode inflar o badge: o usuario ja leu isso no celular.
    expect(listChats().find((c) => c.jid === jid)?.unread).toBe(0)
    // Nem processar um pedido de descadastro de meses atras como se fosse agora.
    expect(getOptOutSet().has(`+${jid.split('@')[0]}`)).toBe(false)
  })

  it('emite um unico evento no fim do lote', () => {
    const seen: unknown[] = []
    inboxEvents.on('changed', (p) => seen.push(p))

    const jid = freshJid()
    handleHistorySet({
      chats: [{ id: jid }],
      messages: [
        incoming(jid, { conversation: 'a' }),
        incoming(jid, { conversation: 'b' }),
        incoming(jid, { conversation: 'c' })
      ]
    } as never)

    // Uma mensagem de historico nao dispara evento propria; so o resumo final.
    expect(seen).toEqual([{ chatJid: '*' }])
  })

  it('repassa o progresso e marca o fim no ultimo lote', () => {
    resetHistorySyncState()
    const jid = freshJid()

    handleHistorySet({
      chats: [{ id: jid }],
      messages: [incoming(jid, { conversation: 'a' }), incoming(jid, { conversation: 'b' })],
      progress: 40
    } as never)

    // Com o historico completo ligado, os lotes levam minutos. Sem progresso a
    // tela pareceria travada e o usuario concluiria que nao sincroniza.
    let state = getHistorySyncState()
    expect(state.running).toBe(true)
    expect(state.percent).toBe(40)
    expect(state.messages).toBe(2)

    handleHistorySet({
      chats: [{ id: jid }],
      messages: [incoming(jid, { conversation: 'c' })],
      progress: 100,
      isLatest: true
    } as never)

    state = getHistorySyncState()
    expect(state.running).toBe(false)
    // O contador soma os lotes: e o unico numero que mostra avanco de verdade.
    expect(state.messages).toBe(3)
  })
})

describe('paginacao da conversa', () => {
  it('serve as ultimas N e conta o total, para a tela saber se ha passado', () => {
    const jid = freshJid()
    for (let i = 0; i < 12; i++) {
      handleUpsert([incoming(jid, { conversation: `msg ${i}` })] as never)
    }

    expect(countMessages(jid)).toBe(12)
    const janela = listMessages(jid, 5)
    expect(janela).toHaveLength(5)
    // Em ordem cronologica, e sao as MAIS RECENTES: a conversa abre pelo fim.
    expect(janela.map((m) => m.body)).toEqual(['msg 7', 'msg 8', 'msg 9', 'msg 10', 'msg 11'])
  })

  it('aponta a mensagem mais antiga, que ancora o pedido de historico', () => {
    const jid = freshJid()
    // Timestamp explicito e anterior ao de `incoming` (1_700_000_000): a ancora
    // e a mensagem mais ANTIGA, e sem ts o codigo cairia em Date.now().
    handleUpsert([
      {
        key: { id: 'ANCORA', remoteJid: jid, fromMe: false },
        message: { conversation: 'primeira' },
        messageTimestamp: 1_600_000_000
      }
    ] as never)
    handleUpsert([incoming(jid, { conversation: 'segunda' })] as never)

    const oldest = oldestMessage(jid)
    expect(oldest?.id).toBe('ANCORA')
    expect(oldest?.remoteJid).toBe(jid)
    expect(oldest?.fromMe).toBe(false)
  })

  it('nao tem ancora quando a conversa esta vazia', () => {
    expect(oldestMessage(freshJid())).toBeNull()
  })
})

describe('handleMessagesUpdate', () => {
  it('avanca o status de entrega, mas nunca retrocede', () => {
    const jid = freshJid()
    handleUpsert([
      { key: { id: 'OUT1', remoteJid: jid, fromMe: true }, message: { conversation: 'ola' } }
    ] as never)

    handleMessagesUpdate([{ key: { id: 'OUT1', remoteJid: jid }, update: { status: 3 } }])
    expect(getMessage('OUT1')?.status).toBe('delivered')

    handleMessagesUpdate([{ key: { id: 'OUT1', remoteJid: jid }, update: { status: 4 } }])
    expect(getMessage('OUT1')?.status).toBe('read')

    // Ack fora de ordem depois de reconectar nao pode voltar para "entregue".
    handleMessagesUpdate([{ key: { id: 'OUT1', remoteJid: jid }, update: { status: 3 } }])
    expect(getMessage('OUT1')?.status).toBe('read')
  })
})

describe('handleContacts', () => {
  it('grava o nome da agenda na conversa', () => {
    const jid = freshJid()
    handleUpsert([incoming(jid, { conversation: 'oi' })] as never)
    handleContacts([{ id: jid, name: 'Maria Souza' }])
    expect(getChat(jid)?.name).toBe('Maria Souza')
  })

  it('nao cria conversa para numero da agenda que nunca escreveu', () => {
    // A agenda do celular tem milhares de numeros. Criar um item de inbox para
    // cada um enchia a lista de conversas vazias — todas datadas de hoje, que e
    // o que fazia "numero sincronizado" aparecer com a data errada.
    const jid = freshJid()
    handleContacts([{ id: jid, name: 'Contato sem conversa' }])
    expect(getChat(jid)).toBeUndefined()
  })
})

describe('aviso de resposta do historico', () => {
  it('anuncia o lote recebido com o id do pedido e o que entrou', () => {
    const jid = freshJid()
    const lotes: unknown[] = []
    inboxEvents.on('historyBatch', (b) => lotes.push(b))

    handleHistorySet({
      chats: [{ id: jid }],
      messages: [incoming(jid, { conversation: 'antiga' })],
      peerDataRequestSessionId: 'PDO-123',
      syncType: 6 // ON_DEMAND
    } as never)

    // Sem este evento, quem pediu historico so poderia esperar um tempo e
    // chutar "acabou" — que e o que marcava conversa vazia como completa.
    expect(lotes).toEqual([
      { requestId: 'PDO-123', syncType: 6, inserted: { [jid]: 1 }, jids: [jid] }
    ])
  })

  it('repassa o tipo do lote, que e o que separa resposta nossa de sync inicial', () => {
    // Um lote RECENT chegando logo depois do nosso pedido parece sucesso e nao
    // e. Sem o tipo no evento, quem espera a resposta nao tem como distinguir.
    const jid = freshJid()
    const lotes: { syncType?: number | null }[] = []
    inboxEvents.on('historyBatch', (b) => lotes.push(b))

    handleHistorySet({
      messages: [incoming(jid, { conversation: 'recente' })],
      syncType: 3
    } as never)
    expect(lotes[0]?.syncType).toBe(3)

    // Lote sem o campo continua valendo: versoes antigas do protocolo nao o
    // preenchem, e cair fora por isso seria pior que nao saber o tipo.
    lotes.length = 0
    handleHistorySet({ messages: [incoming(freshJid(), { conversation: 'x' })] } as never)
    expect(lotes[0]?.syncType).toBeNull()
  })

  it('traduz o tipo do lote para nome legivel no log', () => {
    expect(historySyncTypeName(6)).toBe('ON_DEMAND')
    expect(historySyncTypeName(3)).toBe('RECENT')
    expect(historySyncTypeName(null)).toBe('nao informado')
    expect(historySyncTypeName(99)).toBe('desconhecido(99)')
  })

  it('avisa mesmo quando o lote nao trouxe nada de novo', () => {
    const jid = freshJid()
    handleHistorySet({ messages: [incoming(jid, { conversation: 'ja tinha' })] } as never)

    const lotes: { inserted: Record<string, number> }[] = []
    inboxEvents.on('historyBatch', (b) => lotes.push(b))
    // Mesmo lote de novo: nada entra, mas a resposta existiu.
    handleHistorySet({ chats: [{ id: jid }] } as never)

    expect(lotes).toHaveLength(1)
    expect(lotes[0].inserted).toEqual({})
  })
})

describe('datas vindas do historico', () => {
  it('conversa sem conversationTimestamp fica sem data, e nao com a de hoje', () => {
    const jid = freshJid()
    handleHistorySet({ chats: [{ id: jid, name: 'Antiga' }] } as never)

    const chat = getChat(jid)
    expect(chat?.name).toBe('Antiga')
    expect(chat?.lastTs).toBeNull()
  })

  it('a data da conversa e a da mensagem que veio no lote', () => {
    const jid = freshJid()
    const ts = 1_700_000_000_000

    handleHistorySet({
      chats: [{ id: jid }],
      messages: [incoming(jid, { conversation: 'ola' })]
    } as never)

    expect(getChat(jid)?.lastTs).toBe(ts)
    // E registra ate onde o passado ja foi puxado, para o botao de 7/30 dias
    // saber se ainda precisa pedir algo.
    expect(getChat(jid)?.syncedFrom).toBe(ts)
  })
})
