import { describe, it, expect } from 'vitest'
import { beginQuit, isQuitting, shouldHideOnClose } from './lifecycle'

/**
 * A bandeira de encerramento nao tem volta e o modulo guarda estado global, por
 * isso os testes rodam na ordem do arquivo: tudo que depende de "ainda nao
 * pediram para sair" vem antes do `beginQuit()`.
 */
describe('fechar a janela nao e sair do app', () => {
  it('comeca sem pedido de encerramento', () => {
    expect(isQuitting()).toBe(false)
  })

  it('esconde no X quando fechar-para-bandeja esta ligado', () => {
    expect(shouldHideOnClose(true)).toBe(true)
  })

  it('fecha de verdade quando o usuario desligou a bandeja nas configuracoes', () => {
    expect(shouldHideOnClose(false)).toBe(false)
  })

  it('depois de beginQuit, o fechamento passa mesmo com a bandeja ligada', () => {
    // Sem isto o app viraria um processo impossivel de encerrar: "Sair" na
    // bandeja fecharia a janela, que se esconderia de novo.
    beginQuit()
    expect(isQuitting()).toBe(true)
    expect(shouldHideOnClose(true)).toBe(false)
  })
})
