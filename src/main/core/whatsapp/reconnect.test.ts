import { describe, it, expect } from 'vitest'
import { decideReconnect, backoffFor, MAX_BACKOFF_MS, MAX_RECONNECT_ATTEMPTS } from './reconnect'

const limpo = { intentional: false, attempts: 0 }

describe('decideReconnect', () => {
  it('desconexao pedida pelo usuario nao reagenda nada', () => {
    expect(decideReconnect(undefined, { intentional: true, attempts: 0 })).toEqual({ kind: 'idle' })
    // Nem quando vem com codigo: quem mandou fechar fomos nos.
    expect(decideReconnect(515, { intentional: true, attempts: 0 })).toEqual({ kind: 'idle' })
  })

  it('401 e sessao encerrada no celular: pede QR novo', () => {
    expect(decideReconnect(401, limpo)).toEqual({ kind: 'loggedOut' })
  })

  it('515 reabre na hora e NAO conta como tentativa', () => {
    /**
     * O 515 vem sempre logo depois do QR ser lido — e parte do pareamento, nao
     * falha. Contando como tentativa, o backoff ja nascia perto do teto.
     */
    expect(decideReconnect(515, limpo)).toEqual({ kind: 'reopen' })
    expect(decideReconnect(515, { intentional: false, attempts: 9 })).toEqual({ kind: 'reopen' })
  })

  it('405 nao e retentavel: insistir so aumenta o risco de bloqueio', () => {
    expect(decideReconnect(405, limpo)).toEqual({ kind: 'fatal' })
  })

  it('queda comum entra no backoff exponencial', () => {
    expect(decideReconnect(428, limpo)).toEqual({ kind: 'backoff', delayMs: 1000 })
    expect(decideReconnect(428, { intentional: false, attempts: 1 })).toEqual({
      kind: 'backoff',
      delayMs: 2000
    })
    // Sem codigo nenhum (socket morreu sem Boom) tambem reconecta.
    expect(decideReconnect(undefined, limpo)).toEqual({ kind: 'backoff', delayMs: 1000 })
  })

  it('desiste depois do teto em vez de bater no servidor para sempre', () => {
    const acao = decideReconnect(428, { intentional: false, attempts: MAX_RECONNECT_ATTEMPTS })
    expect(acao).toEqual({ kind: 'giveUp' })
  })
})

describe('backoffFor', () => {
  it('dobra a cada tentativa e para no teto', () => {
    expect(backoffFor(0)).toBe(1000)
    expect(backoffFor(3)).toBe(8000)
    expect(backoffFor(20)).toBe(MAX_BACKOFF_MS)
  })
})
