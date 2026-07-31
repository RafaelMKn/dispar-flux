import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `sr-only` do Tailwind posiciona o elemento em `absolute`. Sem um ancestral
 * posicionado, o bloco container dele vira o documento: o elemento escapa do
 * `overflow-y-auto` do <main>, estica o <html> ate a altura em que ficou e a
 * tela ganha uma segunda barra de rolagem.
 *
 * Foi exatamente o que aconteceu com o Toggle na tela de Configuracoes. Nenhum
 * dos testes viu, porque o ambiente aqui e `node` — nao ha layout para medir.
 * Esta trava e textual: nao substitui olhar a tela, mas impede a regressao
 * exata de voltar sem ninguem perceber.
 */

const RENDERER = join(__dirname, 'src')

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsxFiles(full))
    else if (entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

/** Linhas acima do `sr-only` ate a abertura do elemento que o envolve. */
const JANELA = 6

describe('sr-only precisa de ancestral posicionado', () => {
  it('acha os arquivos do renderer (o glob nao silenciou)', () => {
    expect(tsxFiles(RENDERER).length).toBeGreaterThan(0)
  })

  it('todo sr-only tem `relative` no elemento que o envolve', () => {
    const soltos: string[] = []

    for (const file of tsxFiles(RENDERER)) {
      const linhas = readFileSync(file, 'utf8').split('\n')
      linhas.forEach((linha, i) => {
        if (!linha.includes('sr-only')) return
        const contexto = linhas.slice(Math.max(0, i - JANELA), i + 1).join('\n')
        if (!contexto.includes('relative')) {
          soltos.push(`${file.split('src')[2] ?? file}:${i + 1}`)
        }
      })
    }

    expect(
      soltos,
      `sr-only sem ancestral posicionado (vira 2a barra de rolagem): ${soltos.join(', ')}`
    ).toEqual([])
  })
})
