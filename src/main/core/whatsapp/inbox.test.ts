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
  insertMessage,
  oldestMessage,
  oldestAnchor
} from '../../repos/chats'
import { getOptOutSet } from '../../repos/optOuts'
import { resetLidCache, rememberLid } from '../../repos/lidMap'

beforeAll(async () => {
  await initDb()
})

beforeEach(() => {
  setMediaBridge(null)
  inboxEvents.removeAllListeners()
  resetLidCache()
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

  it('so o que vem do WhatsApp ganha carimbo do servidor', () => {
    // O carimbo do servidor e a unica coisa que serve de ancora para o pedido
    // de historico antigo. Ele vem em SEGUNDOS: em ms sempre termina em 000.
    const comCarimbo = freshJid()
    handleUpsert([incoming(comCarimbo, { conversation: 'oi' })] as never)
    const anchor = oldestAnchor(comCarimbo)
    expect(anchor?.ts).toBe(1_700_000_000_000)
    expect(anchor!.ts % 1000).toBe(0)

    // Sem `messageTimestamp` o `ts` cai no nosso relogio — e a linha nao pode
    // virar ancora, sob pena de o celular ignorar o pedido em silencio.
    const semCarimbo = freshJid()
    handleUpsert([
      incoming(semCarimbo, { conversation: 'oi' }, { messageTimestamp: null })
    ] as never)
    expect(listMessages(semCarimbo)).toHaveLength(1)
    expect(oldestAnchor(semCarimbo)).toBeNull()
  })

  it('descarta carimbo absurdo em vez de virar ancora irresolvivel', () => {
    const jid = freshJid()
    handleUpsert([incoming(jid, { conversation: 'oi' }, { messageTimestamp: 1 })] as never)
    expect(listMessages(jid)).toHaveLength(1)
    expect(oldestAnchor(jid)).toBeNull()
  })

  it('o eco do proprio envio corrige o carimbo gravado na hora', () => {
    // Fluxo real do `recordOutgoing`: o app grava com o relogio da maquina e o
    // eco do Baileys chega depois com o carimbo de verdade.
    const jid = freshJid()
    insertMessage({
      id: 'ECHO-IN-1',
      chatJid: jid,
      direction: 'out',
      body: 'oi',
      ts: Date.now(),
      waMessageId: 'ECHO-IN-1'
    })
    expect(oldestAnchor(jid)).toBeNull()

    handleUpsert([
      {
        key: { id: 'ECHO-IN-1', remoteJid: jid, fromMe: true },
        message: { conversation: 'oi' },
        messageTimestamp: 1_700_000_500
      }
    ] as never)

    expect(listMessages(jid)).toHaveLength(1)
    expect(oldestAnchor(jid)?.ts).toBe(1_700_000_500_000)
    // Correcao de carimbo nao e mensagem nova: nao pode contar como nao lida.
    expect(listChats().find((c) => c.jid === jid)?.unread ?? 0).toBe(0)
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
  /**
   * `71700301529149@lid` — LIDs proprios para os testes de historico, para nao
   * colidirem com os do bloco de LID mais abaixo no arquivo.
   */
  let lidCounter = 0
  function freshHistLid(): string {
    lidCounter += 1
    return `8800301529${String(lidCounter).padStart(4, '0')}@lid`
  }

  it('usa o lidPnMappings do lote para salvar conversa endereçada por LID', () => {
    /**
     * O BUG QUE ISTO TRAVA: a mensagem de history sync sai de um blob protobuf,
     * nao de uma stanza ao vivo — ela NAO tem `remoteJidAlt`. O unico jeito de
     * saber de quem e aquela conversa e o `lidPnMappings` que o Baileys 7.x
     * manda no mesmo lote. Ignorando esse campo, um lote real de 5000 mensagens
     * aproveitava 8 conversas e descartava o resto em silencio.
     */
    const lid = freshHistLid()
    const pn = freshJid()

    handleHistorySet({
      chats: [{ id: lid }],
      contacts: [],
      lidPnMappings: [{ lid, pn }],
      messages: [
        incoming(lid, { conversation: 'oi' }),
        incoming(lid, { conversation: 'tudo bem?' })
      ]
    } as never)

    expect(countMessages(pn)).toBe(2)
    expect(getChat(pn)).toBeTruthy()
    expect(getChat(lid)).toBeUndefined()
  })

  it('aplica o lidPnMappings ANTES das mensagens do mesmo lote', () => {
    /**
     * A ordem e o bug inteiro. `applyHistorySet` canonicaliza cada mensagem na
     * hora em que a le, entao um par aprendido depois nao alcança o lote que
     * acabou de ser descartado — e o par so chegaria pelo lote seguinte, que
     * pode nunca vir. Aqui o par e a mensagem viajam juntos, e e a primeira
     * (e unica) passada que tem que dar conta.
     */
    const lid = freshHistLid()
    const pn = freshJid()

    // Sem nenhum conhecimento previo: o mapa esta limpo por causa do beforeEach.
    handleHistorySet({
      lidPnMappings: [{ lid, pn }],
      messages: [incoming(lid, { conversation: 'primeira passada' })]
    } as never)

    expect(countMessages(pn)).toBe(1)
  })

  it('ignora um lidPnMappings com os lados trocados', () => {
    // Mesma disciplina do `canonicalJid`: quem e LID e quem e telefone se decide
    // pelo formato. Aceitar a posicao gravaria um LID na chave da conversa.
    const lid = freshHistLid()
    const pn = freshJid()

    handleHistorySet({
      lidPnMappings: [{ lid: pn, pn: lid }],
      messages: [incoming(lid, { conversation: 'nao deveria entrar' })]
    } as never)

    expect(getChat(lid)).toBeUndefined()
    expect(countMessages(pn)).toBe(0)
  })

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

describe('endereçamento LID', () => {
  function freshLid(): string {
    counter += 1
    return `7170030152${String(counter).padStart(4, '0')}@lid`
  }

  it('mensagem com @lid entra na conversa do TELEFONE, nao numa conversa nova', () => {
    /**
     * O bug que o usuario via: 46 conversas duplicadas na inbox, cada uma com um
     * "numero" que era na verdade um LID. A mesma pessoa aparecia duas vezes —
     * a conversa que o disparo criou pelo numero e a que a resposta dela criou
     * pelo LID.
     */
    const lid = freshLid()
    const pn = freshJid()

    handleUpsert([
      {
        key: { id: `L${counter}`, remoteJid: lid, fromMe: false, remoteJidAlt: pn },
        message: { conversation: 'oi' },
        messageTimestamp: 1_700_000_000
      }
    ] as Parameters<typeof handleUpsert>[0])

    expect(countMessages(pn)).toBe(1)
    expect(getChat(pn)).toBeTruthy()
    expect(getChat(lid)).toBeUndefined()
  })

  it('guarda o LID na conversa: e o endereco que o servidor usa', () => {
    // O fetchMessageHistory manda o chatJid verbatim. Pedir historico pelo
    // telefone numa conversa que o aparelho conhece por LID e mais uma forma de
    // ficar sem resposta.
    const lid = freshLid()
    const pn = freshJid()
    handleUpsert([
      {
        key: { id: `L${counter}`, remoteJid: lid, fromMe: false, remoteJidAlt: pn },
        message: { conversation: 'oi' },
        messageTimestamp: 1_700_000_000
      }
    ] as Parameters<typeof handleUpsert>[0])
    expect(getChat(pn)?.lid).toBe(lid)
  })

  it('conversa endereçada pelo TELEFONE aprende o LID sem passar a falar por ele', () => {
    /**
     * O Baileys 7.x passou a entregar o LID tambem quando a conversa vem pelo
     * numero. Sao duas coisas distintas, e misturar as duas quebraria o que hoje
     * funciona:
     *
     * - o MAPA aprende (e o que evita a duplicata quando a mesma pessoa
     *   responder por LID mais tarde);
     * - `chats.lid` NAO e preenchido. Essa coluna decide por qual endereco o app
     *   FALA — recibo de leitura, presenca, pedido de historico (`protocolJid`).
     *   A prova de que o servidor aceita o LID ali e ele ter usado o LID; se a
     *   conversa chega pelo numero, o numero e o endereco que funciona.
     */
    const pn = freshJid()
    const lid = freshLid()

    handleUpsert([
      {
        key: { id: `PN${(counter += 1)}`, remoteJid: pn, fromMe: false, remoteJidAlt: lid },
        message: { conversation: 'oi' },
        messageTimestamp: 1_700_000_000
      }
    ] as Parameters<typeof handleUpsert>[0])

    expect(countMessages(pn)).toBe(1)
    expect(getChat(pn)?.lid).toBeNull()
    // Mas o par ficou aprendido: uma mensagem por LID agora cai na mesma conversa.
    handleUpsert([
      {
        key: { id: `LD${(counter += 1)}`, remoteJid: lid, fromMe: false },
        message: { conversation: 'de novo' },
        messageTimestamp: 1_700_000_100
      }
    ] as Parameters<typeof handleUpsert>[0])

    expect(countMessages(pn)).toBe(2)
    expect(getChat(lid)).toBeUndefined()
  })

  it('mensagem NOSSA, que nao traz o alternativo, usa o mapa aprendido antes', () => {
    /**
     * No log real, 29 dos 46 LIDs so apareciam em mensagens `fromMe` — que nao
     * carregam o endereco alternativo. Sem aprender o par na mensagem recebida,
     * essas ficariam sem dono para sempre.
     */
    const lid = freshLid()
    const pn = freshJid()

    handleUpsert([
      {
        key: { id: `IN${counter}`, remoteJid: lid, fromMe: false, remoteJidAlt: pn },
        message: { conversation: 'oi' },
        messageTimestamp: 1_700_000_000
      }
    ] as Parameters<typeof handleUpsert>[0])
    counter += 1
    handleUpsert([
      {
        key: { id: `OUT${counter}`, remoteJid: lid, fromMe: true },
        message: { conversation: 'resposta' },
        messageTimestamp: 1_700_000_100
      }
    ] as Parameters<typeof handleUpsert>[0])

    expect(countMessages(pn)).toBe(2)
    expect(getChat(lid)).toBeUndefined()
  })

  it('LID desconhecido NAO vira conversa', () => {
    // Deixar entrar com o LID cru e exatamente o que produzia a duplicata. A
    // mensagem volta pelo historico depois que o USync resolver o numero.
    const lid = freshLid()
    handleUpsert([
      {
        key: { id: `X${counter}`, remoteJid: lid, fromMe: true },
        message: { conversation: 'sem dono' },
        messageTimestamp: 1_700_000_000
      }
    ] as Parameters<typeof handleUpsert>[0])
    expect(getChat(lid)).toBeUndefined()
  })

  it('o mapa ja gravado resolve um LID sem alternativo nenhum', () => {
    const lid = freshLid()
    const pn = freshJid()
    rememberLid(lid, pn, 'usync')

    handleUpsert([
      {
        key: { id: `U${counter}`, remoteJid: lid, fromMe: true },
        message: { conversation: 'do usync' },
        messageTimestamp: 1_700_000_000
      }
    ] as Parameters<typeof handleUpsert>[0])

    expect(countMessages(pn)).toBe(1)
  })

  it('o ack de entrega avisa a conversa canonica, nao o LID', () => {
    // A tela filtra por igualdade (chatJid === active). Um @lid aqui seria um
    // jid que nao existe em lista nenhuma: o "enviado" nunca viraria "lido".
    const lid = freshLid()
    const pn = freshJid()
    rememberLid(lid, pn, 'senderPn')
    const id = `ACK${(counter += 1)}`
    insertMessage({
      id,
      chatJid: pn,
      direction: 'out',
      body: 'oi',
      ts: Date.now(),
      waMessageId: id,
      status: 'sent'
    })

    const vistos: string[] = []
    inboxEvents.on('changed', (p: { chatJid: string }) => vistos.push(p.chatJid))
    handleMessagesUpdate([{ key: { id, remoteJid: lid }, update: { status: 4 } }])

    expect(vistos).toContain(pn)
    expect(vistos).not.toContain(lid)
  })

  it('nome vindo da agenda com LID cola na conversa do telefone', () => {
    const lid = freshLid()
    const pn = freshJid()
    rememberLid(lid, pn, 'senderPn')
    // `handleContacts` usa `create: false` — so preenche nome de conversa que ja
    // existe. Entao a conversa precisa nascer de uma mensagem, como na vida real.
    handleUpsert([
      {
        key: { id: `N${(counter += 1)}`, remoteJid: pn, fromMe: false },
        message: { conversation: 'oi' },
        messageTimestamp: 1_700_000_000
      }
    ] as Parameters<typeof handleUpsert>[0])

    handleContacts([{ id: lid, name: 'Fulano' }])

    expect(getChat(pn)?.name).toBe('Fulano')
  })

  it('o contato do 7.x traz o par lid/phoneNumber e ensina o mapa sozinho', () => {
    /**
     * Quarta fonte de traducao, e a unica que chega junto da agenda: o `Contact`
     * do Baileys 7.x tem `lid` e `phoneNumber` proprios. Sem le-los, um LID que
     * so aparece na agenda continuaria sem dono ate a varredura alcança-lo.
     *
     * O par e colhido mesmo sem nome — este contato nao serviria para mais nada.
     */
    const lid = freshLid()
    const pn = freshJid()

    handleContacts([{ id: lid, lid, phoneNumber: pn }])

    // A mensagem que chegar depois ja encontra a traducao pronta.
    handleUpsert([
      {
        key: { id: `AG${(counter += 1)}`, remoteJid: lid, fromMe: false },
        message: { conversation: 'oi' },
        messageTimestamp: 1_700_000_000
      }
    ] as Parameters<typeof handleUpsert>[0])

    expect(countMessages(pn)).toBe(1)
    expect(getChat(lid)).toBeUndefined()
  })
})
