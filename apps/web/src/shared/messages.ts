// Helpers de mensagem usados nos DOIS processos.
//
// Vivem em `shared` porque o renderer precisa mostrar ao usuario quantas
// mensagens distintas o modo paragrafo gera, e o main precisa do mesmo numero
// ao planejar a campanha. Duas implementacoes divergiriam em silencio.

/** Tamanho de cada pool, ignorando variacoes vazias e pools sem nada. */
export function poolSizes(pools: string[][]): number[] {
  return pools.map((p) => p.filter((v) => v.trim()).length).filter((n) => n > 0)
}

/**
 * Quantas mensagens distintas o modo paragrafo consegue gerar.
 * Produto do tamanho dos pools — e o numero que a UI mostra ao usuario.
 */
export function countCombinations(pools: string[][]): number {
  const sizes = poolSizes(pools)
  if (sizes.length === 0) return 0
  return sizes.reduce((acc, n) => acc * n, 1)
}
