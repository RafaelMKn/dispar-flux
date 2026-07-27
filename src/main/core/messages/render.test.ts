import { describe, it, expect } from 'vitest'
import {
  substituteVars,
  renderFixed,
  renderRotate,
  renderParagraph,
  extractVars,
  tidy,
  type RenderContext
} from './render'
import { countCombinations } from '@shared/messages'

const ctx = (over: Partial<RenderContext> = {}): RenderContext => ({
  name: 'Ana',
  extras: { empresa: 'Acme', cidade: 'Porto Alegre' },
  index: 0,
  ...over
})

describe('substituteVars', () => {
  it('substitui [nome] e campos extras', () => {
    expect(substituteVars('Oi [nome], tudo bem? Aqui e da [empresa].', ctx())).toBe(
      'Oi Ana, tudo bem? Aqui e da Acme.'
    )
  })

  it('e insensivel a caixa no nome do campo', () => {
    expect(substituteVars('[NOME] de [Empresa]', ctx())).toBe('Ana de Acme')
  })

  it('usa o fallback quando o campo esta vazio', () => {
    expect(substituteVars('Oi [nome|cliente], tudo bem?', ctx({ name: null }))).toBe(
      'Oi cliente, tudo bem?'
    )
  })

  it('remove a variavel ausente e limpa a pontuacao orfa', () => {
    // Sem isso, sairia "Oi , tudo bem?" — que denuncia automacao na hora.
    expect(substituteVars('Oi [nome], tudo bem?', ctx({ name: null }))).toBe('Oi, tudo bem?')
    expect(substituteVars('Oi [nome]! Beleza?', ctx({ name: '' }))).toBe('Oi! Beleza?')
  })

  it('campo inexistente nao quebra a mensagem', () => {
    expect(substituteVars('Oi [nome], seu [inexistente] chegou.', ctx())).toBe(
      'Oi Ana, seu chegou.'
    )
  })

  it('preserva quebras de linha e paragrafos', () => {
    const t = 'Oi [nome],\n\nTudo bem?'
    expect(substituteVars(t, ctx())).toBe('Oi Ana,\n\nTudo bem?')
  })
})

describe('renderFixed', () => {
  it('renderiza o texto com as variaveis do contato', () => {
    expect(renderFixed('Ola [nome] de [cidade]', ctx())).toBe('Ola Ana de Porto Alegre')
  })
})

describe('renderRotate', () => {
  const msgs = ['Msg A para [nome]', 'Msg B para [nome]', 'Msg C para [nome]']

  it('faz rodizio deterministico pelo indice', () => {
    expect(renderRotate(msgs, ctx({ index: 0 }))).toBe('Msg A para Ana')
    expect(renderRotate(msgs, ctx({ index: 1 }))).toBe('Msg B para Ana')
    expect(renderRotate(msgs, ctx({ index: 2 }))).toBe('Msg C para Ana')
    expect(renderRotate(msgs, ctx({ index: 3 }))).toBe('Msg A para Ana') // volta ao inicio
  })

  it('distribui uniformemente em lote grande', () => {
    const contagem = new Map<string, number>()
    for (let i = 0; i < 300; i++) {
      const r = renderRotate(msgs, ctx({ index: i }))
      contagem.set(r, (contagem.get(r) ?? 0) + 1)
    }
    // Esse e o motivo de ser deterministico: 100 de cada, exatamente.
    expect([...contagem.values()]).toEqual([100, 100, 100])
  })

  it('ignora mensagens vazias e trata lista vazia', () => {
    expect(renderRotate(['', '  ', 'Unica'], ctx({ index: 5 }))).toBe('Unica')
    expect(renderRotate([], ctx())).toBe('')
  })
})

describe('renderParagraph', () => {
  const config = {
    pools: [
      ['Oi [nome], tudo bem?', 'Ola [nome]!'],
      ['Sou a Marina da Acme.', 'Aqui e a Marina, da Acme.'],
      ['Posso te mandar a tabela?', 'Quer ver as condicoes?']
    ]
  }

  it('monta a mensagem sorteando uma variacao de cada paragrafo', () => {
    // rng fixo em 0 -> sempre a primeira de cada pool
    const r = renderParagraph(config, ctx(), () => 0)
    expect(r).toBe('Oi Ana, tudo bem?\n\nSou a Marina da Acme.\n\nPosso te mandar a tabela?')
  })

  it('rng diferente escolhe outra combinacao', () => {
    const r = renderParagraph(config, ctx(), () => 0.99)
    expect(r).toBe('Ola Ana!\n\nAqui e a Marina, da Acme.\n\nQuer ver as condicoes?')
  })

  it('gera varias combinacoes distintas ao longo do lote', () => {
    const vistas = new Set<string>()
    for (let i = 0; i < 200; i++) vistas.add(renderParagraph(config, ctx()))
    // 2x2x2 = 8 combinacoes possiveis
    expect(vistas.size).toBeGreaterThan(1)
    expect(vistas.size).toBeLessThanOrEqual(8)
  })

  it('ignora pools vazios', () => {
    expect(renderParagraph({ pools: [['A'], [], ['B']] }, ctx(), () => 0)).toBe('A\n\nB')
    expect(renderParagraph({ pools: [] }, ctx())).toBe('')
  })
})

describe('countCombinations', () => {
  it('multiplica o tamanho dos pools', () => {
    expect(
      countCombinations([
        ['a', 'b', 'c'],
        ['d', 'e', 'f'],
        ['g', 'h', 'i']
      ])
    ).toBe(27)
    expect(countCombinations([['a', 'b'], ['c']])).toBe(2)
  })

  it('desconsidera variacoes vazias', () => {
    expect(
      countCombinations([
        ['a', '', '  '],
        ['b', 'c']
      ])
    ).toBe(2)
  })

  it('devolve 0 sem pools utilizaveis', () => {
    expect(countCombinations([])).toBe(0)
    expect(countCombinations([[], ['']])).toBe(0)
  })
})

describe('extractVars', () => {
  it('lista as variaveis usadas, sem repetir e sem o fallback', () => {
    expect(extractVars('Oi [nome], da [empresa]. Certo [nome|amigo]?')).toEqual(['nome', 'empresa'])
  })
})

describe('tidy', () => {
  it('colapsa espacos e corrige espaco antes de pontuacao', () => {
    expect(tidy('Oi   Ana ,  tudo bem ?')).toBe('Oi Ana, tudo bem?')
  })
})
