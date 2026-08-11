/**
 * O que fazer quando a conexao com o WhatsApp cai.
 *
 * PORQUE E UMA FUNCAO PURA E NAO UM PUNHADO DE `if` DENTRO DO HANDLER: o
 * `client.ts` precisa do Electron e do Baileys (que e ESM-only) para carregar,
 * entao nada la e testavel. A decisao — que codigos reabrem na hora, quais
 * esperam o backoff, quais nao devem ser insistidos e quando desistir — e a
 * parte que erra em silencio e a que mais merece teste.
 *
 * Os codigos vem do `DisconnectReason` do Baileys, mas sao passados como numero
 * de proposito: importar o enum aqui traria o pacote ESM junto.
 */

export type ReconnectAction =
  /** Usuario pediu para desconectar: nao ha o que reagendar. */
  | { kind: 'idle' }
  /** Reabrir imediatamente (515, logo apos o pareamento). */
  | { kind: 'reopen' }
  /** Reabrir depois do backoff. */
  | { kind: 'backoff'; delayMs: number }
  /** Sessao invalidada no celular: apaga credenciais e pede QR novo. */
  | { kind: 'loggedOut' }
  /** O WhatsApp recusou o handshake. Insistir so aumenta o risco. */
  | { kind: 'fatal' }
  /** Tentamos o suficiente. Para de tentar e passa a bola para o usuario. */
  | { kind: 'giveUp' }

export interface ReconnectContext {
  /** `disconnect()`/`logout()` foram chamados. */
  intentional: boolean
  /** Tentativas ja feitas desde a ultima conexao bem-sucedida. */
  attempts: number
}

/** Teto do backoff exponencial. */
export const MAX_BACKOFF_MS = 60_000

/**
 * Quantas reconexoes tentamos antes de desistir.
 *
 * Antes nao havia teto: uma sessao definitivamente quebrada ficava batendo no
 * servidor do WhatsApp a cada 60s para sempre, sem nunca dizer isso ao usuario.
 * Dez tentativas passam dos cinco minutos com o backoff cheio — tempo de sobra
 * para uma queda de internet passar.
 */
export const MAX_RECONNECT_ATTEMPTS = 10

/** 405: o WhatsApp recusou o handshake. Retry nao resolve. */
export const FATAL_CODES = new Set([405])

/** Codigos do Baileys que este modulo trata por nome. */
export const DISCONNECT = {
  loggedOut: 401,
  restartRequired: 515
} as const

/** Backoff exponencial a partir da tentativa `attempts` (0 = a primeira). */
export function backoffFor(attempts: number): number {
  return Math.min(1000 * 2 ** attempts, MAX_BACKOFF_MS)
}

export function decideReconnect(
  statusCode: number | undefined,
  ctx: ReconnectContext
): ReconnectAction {
  if (ctx.intentional) return { kind: 'idle' }
  if (statusCode === DISCONNECT.loggedOut) return { kind: 'loggedOut' }

  /**
   * O 515 e parte esperada do pareamento, nao uma falha.
   *
   * Vem sempre logo depois do QR ser lido, e o Baileys exige recriar o socket.
   * Contar isso como tentativa de reconexao empurrava o backoff para perto do
   * teto antes mesmo de a sessao ter conectado uma vez.
   */
  if (statusCode === DISCONNECT.restartRequired) return { kind: 'reopen' }

  if (statusCode !== undefined && FATAL_CODES.has(statusCode)) return { kind: 'fatal' }

  if (ctx.attempts >= MAX_RECONNECT_ATTEMPTS) return { kind: 'giveUp' }
  return { kind: 'backoff', delayMs: backoffFor(ctx.attempts) }
}
