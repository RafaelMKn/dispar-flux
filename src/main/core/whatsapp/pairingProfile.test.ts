import { describe, it, expect } from 'vitest'
import {
  pairingBrowserForAttempt,
  pairingLadderStart,
  DESKTOP_REFUSAL_TTL_MS,
  WINDOWS_BROWSER,
  PAIRING_ATTEMPTS_BEFORE_FALLBACK,
  resolvePairingBrowser,
  pairingKind,
  newPairingRecord,
  LEGACY_BROWSER,
  FULL_HISTORY_BROWSER,
  type PairingRecord
} from './pairingProfile'

/**
 * O teste mais importante desta versao, porque a correcao do historico cabe
 * inteira numa tripla de strings — e ela e facil de "arrumar" sem querer.
 */

function record(over: Partial<PairingRecord> = {}): PairingRecord {
  return {
    browser: FULL_HISTORY_BROWSER,
    platform: 'desktop',
    confirmed: true,
    at: Date.now(),
    waVersion: '2.3000.1035194821',
    ...over
  }
}

describe('resolvePairingBrowser', () => {
  it('pareamento novo se apresenta como cliente desktop', () => {
    const b = resolvePairingBrowser(null, false)

    /**
     * ESTE ERA O BUG. O Baileys so honra o `syncFullHistory` quando
     * `browser[0]` esta no `PLATFORM_MAP` de `lib/Utils/validate-connection.js`,
     * que so tem 'Mac OS' e 'Windows'. Com 'Ubuntu' a sub-plataforma ficava em
     * WEB_BROWSER e o WhatsApp mandava o recorte curto de navegador.
     *
     * Se alguem trocar isto por um nome fora do mapa, o historico volta a
     * encolher em silencio — e nada mais no app percebe.
     */
    expect(b[0]).toBe('Mac OS')
    expect(b[1]).toBe('Desktop')
  })

  it('sessao ja pareada como desktop mantem a tripla do proprio registro', () => {
    // Estabilidade: e o mesmo socket voltando depois do 515, e o handshake tem
    // que bater com o registro que gerou as credenciais.
    const antiga: [string, string, string] = ['Mac OS', 'Desktop', '10.15.0']
    const b = resolvePairingBrowser(record({ browser: antiga }), true)
    expect(b).toEqual(antiga)
  })

  it('sessao ja pareada SEM registro continua na identidade legada', () => {
    /**
     * Quem atualiza o app nao pode ter o handshake trocado embaixo dos pes: o
     * tamanho do historico foi negociado no registro e nao muda no login, entao
     * trocar a identidade agora nao traria nada e so arriscaria a conexao que
     * ja funciona.
     */
    expect(resolvePairingBrowser(null, true)).toEqual(LEGACY_BROWSER)
  })

  it('sessao pareada como navegador tambem fica na identidade legada', () => {
    const b = resolvePairingBrowser(record({ platform: 'web', browser: LEGACY_BROWSER }), true)
    expect(b).toEqual(LEGACY_BROWSER)
  })
})

describe('pairingKind', () => {
  it('sem sessao nao ha o que dizer', () => {
    expect(pairingKind(null, false)).toBeNull()
    expect(pairingKind(record(), false)).toBeNull()
  })

  it('sessao sem registro e legada — a ausencia do registro E o sinal', () => {
    expect(pairingKind(null, true)).toBe('legacy')
  })

  it('registro de navegador e legado; de desktop e completo', () => {
    expect(pairingKind(record({ platform: 'web' }), true)).toBe('legacy')
    expect(pairingKind(record({ platform: 'desktop' }), true)).toBe('full')
  })
})

describe('newPairingRecord', () => {
  it('classifica pelas chaves do PLATFORM_MAP, nao pelo nome bonito', () => {
    expect(newPairingRecord(FULL_HISTORY_BROWSER, '2.3000.1').platform).toBe('desktop')
    expect(newPairingRecord(['Windows', 'Desktop', '10'], null).platform).toBe('desktop')
    expect(newPairingRecord(LEGACY_BROWSER, null).platform).toBe('web')
    // 'Linux' parece desktop e nao esta no mapa do Baileys: e navegador.
    expect(newPairingRecord(['Linux', 'Desktop', '1'], null).platform).toBe('web')
  })

  it('nasce nao confirmado: o 515 reabre o socket antes do primeiro open', () => {
    expect(newPairingRecord(FULL_HISTORY_BROWSER, null).confirmed).toBe(false)
  })
})

describe('fallback de identidade no pareamento', () => {
  it('tenta as duas chaves do PLATFORM_MAP antes de desistir do desktop', () => {
    // 'Mac OS' foi recusado com 428 nesta conta; 'Windows' e o unico outro valor
    // que o Baileys mapeia para uma sub-plataforma desktop.
    expect(pairingBrowserForAttempt(0)).toEqual(FULL_HISTORY_BROWSER)
    expect(pairingBrowserForAttempt(1)).toEqual(FULL_HISTORY_BROWSER)
    expect(pairingBrowserForAttempt(2)).toEqual(WINDOWS_BROWSER)
    expect(pairingBrowserForAttempt(3)).toEqual(WINDOWS_BROWSER)
  })

  it('depois do teto, cai para a identidade legada', () => {
    /**
     * UM APP DE DISPARO QUE NAO CONSEGUE PAREAR ESTA QUEBRADO. Na 0.3.4 o
     * servidor derrubou o stream com 428 antes de emitir o QR, em loop, e o
     * usuario ficou sem conseguir conectar de jeito nenhum. O historico maior e
     * um bonus — nao pode ser condicao para o app funcionar.
     */
    expect(pairingBrowserForAttempt(PAIRING_ATTEMPTS_BEFORE_FALLBACK)).toEqual(LEGACY_BROWSER)
    expect(pairingBrowserForAttempt(99)).toEqual(LEGACY_BROWSER)
  })

  it('resolvePairingBrowser leva as tentativas em conta', () => {
    expect(resolvePairingBrowser(null, false, 0)).toEqual(FULL_HISTORY_BROWSER)
    expect(resolvePairingBrowser(null, false, PAIRING_ATTEMPTS_BEFORE_FALLBACK)).toEqual(
      LEGACY_BROWSER
    )
    // Sessao JA pareada nao e afetada por tentativa nenhuma.
    expect(resolvePairingBrowser(null, true, 99)).toEqual(LEGACY_BROWSER)
  })

  it('a versao do SO e a mesma que o Baileys usa', () => {
    // Antes daqui saia um 10.15.7 inventado (macOS de 2019). Um cliente desktop
    // se dizendo tao antigo e o tipo de detalhe que um servidor pode recusar.
    expect(FULL_HISTORY_BROWSER[2]).toBe('14.4.1')
  })
})

describe('memoria da recusa', () => {
  it('sem recusa registrada, a escada comeca do topo', () => {
    expect(pairingLadderStart(null)).toBe(0)
  })

  it('recusa recente pula direto para a identidade que pareia', () => {
    /**
     * Repetir a escada inteira a cada pareamento faria o usuario esperar quatro
     * falhas e um backoff para chegar exatamente no mesmo lugar.
     */
    expect(pairingLadderStart(Date.now() - 1000)).toBe(PAIRING_ATTEMPTS_BEFORE_FALLBACK)
    expect(pairingBrowserForAttempt(pairingLadderStart(Date.now() - 1000))).toEqual(LEGACY_BROWSER)
  })

  it('recusa antiga expira: isso e decisao do lado deles e pode mudar', () => {
    const antiga = Date.now() - DESKTOP_REFUSAL_TTL_MS - 1
    expect(pairingLadderStart(antiga)).toBe(0)
  })
})
