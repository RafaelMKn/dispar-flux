/**
 * Com que IDENTIDADE o app se apresenta ao WhatsApp no handshake.
 *
 * ISTO DECIDE QUANTO HISTORICO A CONTA RECEBE, e por muito tempo decidiu errado.
 *
 * O Baileys so ativa o `syncFullHistory` quando o primeiro item do `browser`
 * esta no mapa dele (`lib/Utils/validate-connection.js`):
 *
 *     const PLATFORM_MAP = {
 *       'Mac OS': WebSubPlatform.DARWIN,
 *       Windows:  WebSubPlatform.WIN32
 *     }
 *     if (config.syncFullHistory && PLATFORM_MAP[config.browser[0]]) { ... }
 *
 * O app anunciava `['Ubuntu', 'Chrome', ...]`, e `'Ubuntu'` NAO esta no mapa —
 * entao a sub-plataforma continuava `WEB_BROWSER`.
 *
 * O EFEITO ERA PELA METADE, e vale ser preciso: o `requireFullSync` viaja no
 * `generateRegistrationNode` independente do `browser`, entao ele saia. Um log
 * real de 15 dias mostra o pareamento trazendo ~65 mil mensagens com o progresso
 * indo de 0 a 100. O que NAO acontecia era a sub-plataforma desktop — e e ela
 * que decide o TAMANHO da janela. O mesmo log corrobora: a mensagem mais antiga
 * que o app alcancou era de ~3 meses antes daquele pareamento, exatamente a
 * janela de navegador, contra cerca de 1 ano de um cliente desktop.
 *
 * Foi essa lacuna que empurrou o produto para a busca sob demanda, que e o
 * mecanismo nao confiavel do outro lado do problema.
 *
 * O TAMANHO DO HISTORICO E NEGOCIADO NO PAREAMENTO, nao a cada login: o
 * `requireFullSync` e o `historySyncConfig` viajam no `generateRegistrationNode`,
 * que so acontece quando o QR e lido. Por isso a identidade e propriedade da
 * SESSAO, e nao uma constante global — trocar a identidade de login de uma
 * sessao ja pareada nao traria historico nenhum e ainda poria o handshake de
 * quem ja usa o app num caminho nao testado.
 *
 * Modulo puro: sem Electron, sem Baileys, para o teste conseguir travar a tripla.
 */

export type BrowserTriple = [string, string, string]

/**
 * A identidade com que TODAS as sessoes anteriores a esta versao se parearam.
 *
 * Quem ja esta conectado continua usando exatamente esta — ver
 * `resolvePairingBrowser`.
 */
export const LEGACY_BROWSER: BrowserTriple = ['Ubuntu', 'Chrome', '120.0.0.0']

/**
 * A identidade de um cliente desktop, a unica que faz o `syncFullHistory` valer.
 *
 * `'Mac OS'` cai em `PLATFORM_MAP` → `DARWIN`; `'Desktop'` cai em
 * `DeviceProps.PlatformType.DESKTOP`. Entre as duas chaves possiveis do mapa,
 * `'Mac OS'` foi escolhido em vez de `'Windows'` porque o segundo aparece
 * associado a rejeicoes 405 nos relatos do Baileys — foi por isso que o app
 * tinha ido parar em `'Ubuntu'`.
 *
 * Efeito visivel: em "Dispositivos conectados" o celular passa a listar um Mac.
 *
 * A versao do SO e a MESMA que o `Browsers.macOS` do proprio Baileys usa
 * (`14.4.1`). Antes daqui saia um `10.15.7` inventado — macOS Catalina, de 2019 —
 * e um cliente desktop se dizendo tao antigo e exatamente o tipo de detalhe que
 * um servidor pode recusar. Nao ha por que divergir do que a biblioteca manda.
 */
export const FULL_HISTORY_BROWSER: BrowserTriple = ['Mac OS', 'Desktop', '14.4.1']

/**
 * A outra chave do `PLATFORM_MAP`, tentada antes de desistir do desktop.
 *
 * `'Mac OS'` foi recusado com 428 nesta conta (tres tentativas, QR nenhum). Nao
 * da para saber daqui se o servidor recusa a SUB-PLATAFORMA desktop ou o Mac
 * especificamente — e `'Windows'` e o unico outro valor que o Baileys mapeia.
 * Uma tentativa e barata; o comentario antigo que associava Windows a 405 falava
 * de outro codigo e de outra epoca, e nunca foi verificado aqui.
 */
export const WINDOWS_BROWSER: BrowserTriple = ['Windows', 'Desktop', '10.0.22631']

/**
 * Quantas vezes tentamos parear como desktop antes de cair para a identidade
 * legada.
 *
 * PORQUE ISTO EXISTE: o caminho de pareamento NOVO so foi exercitado pela
 * primeira vez em producao na 0.3.4, e o servidor derrubou o stream com 428
 * antes mesmo de emitir o QR — em loop, sem o usuario conseguir conectar de
 * jeito nenhum. Um app de disparo que nao consegue parear esta quebrado; o
 * historico maior e um bonus, nao pode ser condicao para funcionar.
 */
export const PAIRING_ATTEMPTS_BEFORE_FALLBACK = 4

/**
 * A escada de identidades do pareamento.
 *
 * Duas tentativas em cada chave do `PLATFORM_MAP` e depois a legada. O teto e
 * baixo de proposito: cada degrau custa uma falha e um backoff antes de o QR
 * aparecer, e fazer o usuario esperar para satisfazer nossa curiosidade seria
 * caro. Quando a recusa fica registrada (`desktopRefused`), esta escada nem
 * chega a ser percorrida de novo — ver `pairingLadderStart`.
 */
const PAIRING_LADDER: BrowserTriple[] = [
  FULL_HISTORY_BROWSER,
  FULL_HISTORY_BROWSER,
  WINDOWS_BROWSER,
  WINDOWS_BROWSER
]

/**
 * Que identidade tentar neste pareamento, dado quantas ja falharam.
 *
 * Depois do teto, volta para a identidade legada — empiricamente conhecida por
 * parear. O usuario conecta e perde so a janela maior de historico, o que e
 * infinitamente melhor que nao conectar.
 */
export function pairingBrowserForAttempt(attempt: number): BrowserTriple {
  return PAIRING_LADDER[attempt] ?? LEGACY_BROWSER
}

/**
 * Por onde a escada comeca.
 *
 * Depois que o servidor recusou o desktop, repetir a escada inteira a cada
 * pareamento so faz o usuario esperar quatro falhas para chegar no mesmo lugar.
 * O registro tem validade porque isso e decisao do lado deles e pode mudar —
 * daqui a um mes vale tentar de novo.
 */
export const DESKTOP_REFUSAL_TTL_MS = 30 * 24 * 60 * 60 * 1000

export function pairingLadderStart(desktopRefusedAt: number | null, now = Date.now()): number {
  if (desktopRefusedAt && now - desktopRefusedAt < DESKTOP_REFUSAL_TTL_MS) {
    return PAIRING_ATTEMPTS_BEFORE_FALLBACK
  }
  return 0
}

/** O que sabemos sobre COMO a sessao atual foi pareada. Settings: `wa.pairing`. */
export interface PairingRecord {
  browser: BrowserTriple
  /**
   * Como o WhatsApp enxergou esta sessao.
   *
   * `'desktop'` = o `browser[0]` caiu no `PLATFORM_MAP` do Baileys e o
   * `syncFullHistory` valeu; `'web'` = ficou em `WEB_BROWSER` e o historico veio
   * curto. E este campo que decide se vale sugerir um novo pareamento.
   */
  platform: 'desktop' | 'web'
  /**
   * Ja vimos esta sessao conectar de fato?
   *
   * Fica `false` entre a leitura do QR e o primeiro `connection: open` — e no
   * meio disso acontece o 515, que reabre o socket. O registro precisa existir
   * ANTES desse segundo socket, senao ele resolveria a identidade de novo e
   * divergiria do proprio registro.
   */
  confirmed: boolean
  at: number
  waVersion: string | null
}

/**
 * Que identidade anunciar neste socket.
 *
 * - Sessao nova (sem credenciais): a de desktop, que e o ponto de toda a
 *   correcao.
 * - Sessao ja pareada como desktop: a MESMA do registro, byte a byte. A
 *   estabilidade importa: e o mesmo socket voltando depois do 515.
 * - Sessao ja pareada sem registro (ou pareada como navegador): a legada. Ela
 *   ja negociou o historico curto no registro; mudar a identidade agora nao
 *   traria nada e so arriscaria o handshake de quem esta funcionando.
 */
export function resolvePairingBrowser(
  record: PairingRecord | null,
  paired: boolean,
  /** Tentativas de pareamento que ja falharam sem sequer emitir QR. */
  failedPairAttempts = 0
): BrowserTriple {
  if (!paired) return pairingBrowserForAttempt(failedPairAttempts)
  if (record?.platform === 'desktop') return record.browser
  return LEGACY_BROWSER
}

/**
 * Quanto historico esta sessao consegue receber.
 *
 * `null` = nao ha sessao. `'legacy'` = pareada como navegador por uma versao
 * anterior; refazer o pareamento libera o pacote maior.
 */
export function pairingKind(
  record: PairingRecord | null,
  hasSession: boolean
): 'full' | 'legacy' | null {
  if (!hasSession) return null
  return record?.platform === 'desktop' ? 'full' : 'legacy'
}

/** As chaves do `PLATFORM_MAP` do Baileys — as unicas que ligam o historico cheio. */
const FULL_HISTORY_PLATFORMS = new Set(['Mac OS', 'Windows'])

/** O registro a gravar quando um pareamento novo comeca. */
export function newPairingRecord(browser: BrowserTriple, waVersion: string | null): PairingRecord {
  return {
    browser,
    platform: FULL_HISTORY_PLATFORMS.has(browser[0]) ? 'desktop' : 'web',
    confirmed: false,
    at: Date.now(),
    waVersion
  }
}
