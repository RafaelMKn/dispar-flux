import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { initDb } from '../../db'
import { isLid, canonicalJid } from './lid'
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

  it('resolve pelo senderPn que vem na chave da mensagem', () => {
    const lid = freshLid()
    const pn = freshPn()
    expect(canonicalJid(lid, { senderPn: pn })).toBe(pn)
  })

  it('APRENDE ao resolver, para a mensagem fromMe seguinte funcionar', () => {
    /**
     * O ponto todo do modulo. Mensagem `fromMe: true` NAO traz `senderPn` — no
     * log real, 29 dos 46 LIDs so apareciam assim. Se o par nao fosse gravado
     * na primeira mensagem recebida, as nossas continuariam sem dono e a
     * conversa continuaria partida em duas.
     */
    const lid = freshLid()
    const pn = freshPn()

    canonicalJid(lid, { senderPn: pn })
    // Agora sem pista nenhuma, como chega uma mensagem nossa:
    expect(canonicalJid(lid)).toBe(pn)
  })

  it('devolve null para LID que ainda nao sabemos de quem e', () => {
    // Resultado legitimo: quem chama tem que tratar. Criar a conversa com o LID
    // cru e o que produzia a duplicata na inbox.
    expect(canonicalJid(freshLid())).toBeNull()
  })

  it('nao aceita um senderPn que tambem e LID', () => {
    const lid = freshLid()
    expect(canonicalJid(lid, { senderPn: freshLid() })).toBeNull()
  })

  it('null e undefined nao viram conversa', () => {
    expect(canonicalJid(null)).toBeNull()
    expect(canonicalJid(undefined)).toBeNull()
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
     * `senderPn` e o servidor falando daquela conversa; o USync e uma pergunta
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
