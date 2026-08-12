import { describe, it, expect } from 'vitest'
import { isOptOutRequest, normalizeMessage, jidToE164 } from './optOutDetect'

describe('isOptOutRequest', () => {
  it('reconhece as palavras-chave em varias formas de escrita', () => {
    for (const msg of [
      'SAIR',
      'sair',
      'Sair',
      '  sair  ',
      'sair.',
      'SAIR!',
      'parar',
      'PARE',
      'stop',
      'Cancelar',
      'descadastrar',
      'remover',
      'nao quero',
      'não quero', // com acento
      'unsubscribe',
      'me tire da lista'
    ]) {
      expect(isOptOutRequest(msg), msg).toBe(true)
    }
  })

  it('NAO marca opt-out em frases que apenas contem a palavra', () => {
    // Este e o caso que importa: falso positivo faz o usuario perder um lead
    // legitimo sem entender por que.
    for (const msg of [
      'vou sair mais tarde, te falo depois',
      'pode parar de chover?',
      'preciso cancelar meu pedido de ontem',
      'vou remover o item do carrinho',
      'nao quero o azul, quero o vermelho',
      'onde fica a saida?',
      'stop motion e legal'
    ]) {
      expect(isOptOutRequest(msg), msg).toBe(false)
    }
  })

  it('trata vazio e nulo', () => {
    expect(isOptOutRequest('')).toBe(false)
    expect(isOptOutRequest(null)).toBe(false)
    expect(isOptOutRequest(undefined)).toBe(false)
    expect(isOptOutRequest('   ')).toBe(false)
  })
})

describe('normalizeMessage', () => {
  it('remove acento, pontuacao e colapsa espacos', () => {
    expect(normalizeMessage('  NÃO   QUERO!! ')).toBe('nao quero')
  })
})

describe('jidToE164', () => {
  it('converte jid do WhatsApp em E.164', () => {
    expect(jidToE164('5511987654210@s.whatsapp.net')).toBe('+5511987654210')
  })

  it('descarta o sufixo de dispositivo', () => {
    expect(jidToE164('555132554210:11@s.whatsapp.net')).toBe('+555132554210')
  })

  it('devolve null para jid sem numero utilizavel', () => {
    expect(jidToE164('status@broadcast')).toBeNull()
  })

  it('LID nao e telefone, mesmo tendo digitos de sobra', () => {
    /**
     * ESTE ERA UM BUG SILENCIOSO E CARO. Um LID de 14 digitos passava no teste
     * de comprimento e virava `+71700301529149`. Quem respondia SAIR numa
     * conversa LID nao era descadastrado — o telefone real nunca entrava na
     * `opt_outs`, que e global a todas as bases — e ainda ficava um numero
     * inexistente gravado la.
     */
    expect(jidToE164('71700301529149@lid')).toBeNull()
    expect(jidToE164('128033663008918@lid')).toBeNull()
  })
})
