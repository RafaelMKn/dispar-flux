import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { initDb } from '../../db'
import { isLid, canonicalJid, harvestGroupLid, normalizeLid, learnLidPair } from './lid'
import { rememberLid, pnForLid, lidForPn, resetLidCache } from '../../repos/lidMap'

beforeAll(async () => {
  await initDb()
})

beforeEach(() => {
  resetLidCache()
})

let n = 0
function freshLid(): string {
  n += 1
  return `7170030152${String(n).padStart(4, '0')}@lid`
}
function freshPn(): string {
  n += 1
  return `5551845793${String(n).padStart(2, '0')}@s.whatsapp.net`
}

describe('isLid', () => {
  it('separa o endereçamento novo do telefone', () => {
    expect(isLid('71700301529149@lid')).toBe(true)
    expect(isLid('555184579349@s.whatsapp.net')).toBe(false)
    expect(isLid('120363000000@g.us')).toBe(false)
    expect(isLid(null)).toBe(false)
    expect(isLid(undefined)).toBe(false)
  })
})

describe('canonicalJid', () => {
  it('jid de telefone passa intacto', () => {
    const pn = freshPn()
    expect(canonicalJid(pn)).toBe(pn)
  })

  it('resolve pelo endereco alternativo que vem na chave da mensagem', () => {
    const lid = freshLid()
    const pn = freshPn()
    expect(canonicalJid(lid, { alt: pn })).toBe(pn)
  })

  it('APRENDE ao resolver, para a mensagem fromMe seguinte funcionar', () => {
    /**
     * O ponto todo do modulo. Mensagem `fromMe: true` NAO traz o alternativo — no
     * log real, 29 dos 46 LIDs so apareciam assim. Se o par nao fosse gravado
     * na primeira mensagem recebida, as nossas continuariam sem dono e a
     * conversa continuaria partida em duas.
     */
    const lid = freshLid()
    const pn = freshPn()

    canonicalJid(lid, { alt: pn })
    // Agora sem pista nenhuma, como chega uma mensagem nossa:
    expect(canonicalJid(lid)).toBe(pn)
  })

  it('devolve null para LID que ainda nao sabemos de quem e', () => {
    // Resultado legitimo: quem chama tem que tratar. Criar a conversa com o LID
    // cru e o que produzia a duplicata na inbox.
    expect(canonicalJid(freshLid())).toBeNull()
  })

  it('nao aceita um alternativo que tambem e LID', () => {
    const lid = freshLid()
    expect(canonicalJid(lid, { alt: freshLid() })).toBeNull()
  })

  it('null e undefined nao viram conversa', () => {
    expect(canonicalJid(null)).toBeNull()
    expect(canonicalJid(undefined)).toBeNull()
  })

  it('conversa por telefone APRENDE o LID que vem no alternativo', () => {
    /**
     * O sentido que so passou a existir no Baileys 7.x.
     *
     * Ate o 6.7.23 o campo era de mao unica (LID -> telefone) e so aparecia em
     * conversa endereçada por LID. Agora, quando a conversa vem pelo numero, o
     * alternativo traz o LID DELA — de graca, sem a consulta que o `sweepLids`
     * precisa fazer ao servidor.
     */
    const pn = freshPn()
    const lid = freshLid()

    // A chave nao muda: telefone entra, telefone sai.
    expect(canonicalJid(pn, { alt: lid })).toBe(pn)
    // Mas o par ficou gravado, e uma mensagem futura por LID ja resolve.
    expect(canonicalJid(lid)).toBe(pn)
  })

  it('NAO troca a chave de telefone por LID quando o alternativo e LID', () => {
    /**
     * A duplicata ao contrario, e o risco central da migracao para o 7.x: ler o
     * alternativo como se fosse sempre o telefone gravaria um LID na chave da
     * conversa — pior que o bug original, porque suja o banco.
     */
    const pn = freshPn()
    const lid = freshLid()
    expect(canonicalJid(pn, { alt: lid })).not.toBe(lid)
  })

  it('nao aceita um @hosted.lid no lugar do telefone', () => {
    /**
     * `@hosted.lid` e outro servidor do Baileys 7.x e NAO termina em `@lid`,
     * entao a guarda antiga (`!isLid(...)`) o deixaria passar como se fosse
     * numero. Exigir `@s.whatsapp.net` erra para o lado seguro: fica sem
     * traducao por enquanto, em vez de com uma traducao errada para sempre.
     */
    const lid = freshLid()
    expect(canonicalJid(lid, { alt: '71700301529149@hosted.lid' })).toBeNull()
  })
})

describe('lidMap', () => {
  it('guarda e le nos dois sentidos', () => {
    const lid = freshLid()
    const pn = freshPn()
    rememberLid(lid, pn, 'senderPn')

    expect(pnForLid(lid)).toBe(pn)
    expect(lidForPn(pn)).toBe(lid)
  })

  it('o par sobrevive ao reinicio do app', () => {
    const lid = freshLid()
    const pn = freshPn()
    rememberLid(lid, pn, 'usync')

    // Sem isso, cada reinicio recomeçaria do zero e a conversa voltaria a se
    // partir em duas ate a proxima mensagem recebida.
    resetLidCache()
    expect(pnForLid(lid)).toBe(pn)
  })

  it('consulta USync nao sobrescreve o que veio do envelope', () => {
    /**
     * `senderPn` e o servidor falando daquela conversa por conta propria; o
     * USync e uma pergunta
     * nossa, que pode devolver o LID de um numero que a pessoa nao usa mais.
     */
    const lid = freshLid()
    const certo = freshPn()
    const errado = freshPn()

    rememberLid(lid, certo, 'senderPn')
    rememberLid(lid, errado, 'usync')

    expect(pnForLid(lid)).toBe(certo)
  })

  it('o envelope corrige um mapeamento que veio do USync', () => {
    const lid = freshLid()
    const antigo = freshPn()
    const certo = freshPn()

    rememberLid(lid, antigo, 'usync')
    rememberLid(lid, certo, 'senderPn')

    expect(pnForLid(lid)).toBe(certo)
  })
})

describe('sufixo de dispositivo', () => {
  it('as duas formas do mesmo LID resolvem para o mesmo telefone', () => {
    /**
     * `71700301529149:23@lid` e `71700301529149@lid` sao A MESMA PESSOA — o `:23`
     * so diz de qual aparelho dela veio. No log real, 7 dos 46 LIDs aparecem nas
     * duas formas, e a comparacao crua fazia esses nunca casarem: nem no mapa,
     * nem na hora de fundir a conversa.
     */
    const pn = freshPn()
    const base = '71700301529149@lid'
    const comDispositivo = '71700301529149:23@lid'

    canonicalJid(comDispositivo, { alt: pn })

    expect(canonicalJid(base)).toBe(pn)
    expect(canonicalJid(comDispositivo)).toBe(pn)
  })

  it('o telefone e normalizado ao ser aprendido, nao so o LID', () => {
    /**
     * O `getPNsForLIDs` do Baileys 7.x devolve o telefone com o dispositivo
     * SEMPRE colado — `555181360431:0@s.whatsapp.net`, inclusive quando e zero.
     * O `rememberLid` normalizava so o lado do LID, entao o mapa passaria a
     * apontar para um jid que nao existe em conversa nenhuma: o diagnostico
     * mostraria a traducao como resolvida e o merge nao acharia a linha.
     */
    const lid = freshLid()
    const pn = freshPn()

    expect(learnLidPair(lid, `${pn.split('@')[0]}:0@s.whatsapp.net`, 'usync')).toBe(true)
    expect(pnForLid(lid)).toBe(pn)
    // E a chave que sai para a conversa tambem vem limpa.
    expect(canonicalJid(lid)).toBe(pn)
  })

  it('o alternativo com dispositivo nao cria conversa paralela por aparelho', () => {
    const lid = freshLid()
    const pn = freshPn()
    const comAparelho = `${pn.split('@')[0]}:17@s.whatsapp.net`

    expect(canonicalJid(lid, { alt: comAparelho })).toBe(pn)
  })

  it('normalizeLid tira so o dispositivo, preservando o resto', () => {
    expect(normalizeLid('71700301529149:23@lid')).toBe('71700301529149@lid')
    expect(normalizeLid('71700301529149@lid')).toBe('71700301529149@lid')
    // Jid de telefone com dispositivo tambem: `me` chega assim (`...:14@...`).
    expect(normalizeLid('555181360431:14@s.whatsapp.net')).toBe('555181360431@s.whatsapp.net')
  })
})

describe('harvestGroupLid', () => {
  it('colhe o par que a mensagem de grupo traz de graca', () => {
    /**
     * No log real sao 42 pares assim, contra 17 vindos de conversa 1:1. O grupo
     * continua sendo descartado, mas o par nao.
     */
    const lid = freshLid()
    const pn = freshPn()
    harvestGroupLid({ participant: lid, participantAlt: pn })
    expect(canonicalJid(lid)).toBe(pn)
  })

  it('ignora chave sem os dois lados do par', () => {
    const lid = freshLid()
    harvestGroupLid({ participant: lid })
    harvestGroupLid({ participantAlt: freshPn() })
    harvestGroupLid({})
    expect(canonicalJid(lid)).toBeNull()
  })

  it('nao aceita um par em que os dois lados sao LID', () => {
    const lid = freshLid()
    harvestGroupLid({ participant: lid, participantAlt: freshLid() })
    expect(canonicalJid(lid)).toBeNull()
  })

  it('colhe o par tambem quando ele vem na ordem inversa', () => {
    /**
     * Em grupo o `participantAlt` e bidirecional igual ao `remoteJidAlt`: quem
     * falou pode vir pelo telefone e o alternativo ser o LID. Decidir pela
     * POSICAO em vez do formato perderia metade dos pares — ou, pior, gravaria
     * o telefone como se fosse o LID.
     */
    const lid = freshLid()
    const pn = freshPn()
    harvestGroupLid({ participant: pn, participantAlt: lid })
    expect(canonicalJid(lid)).toBe(pn)
  })
})
