/**
 * Leitura e escrita da versao do WhatsApp Web como texto.
 *
 * Fica em `shared` porque o renderer digita a string e o main precisa da tupla,
 * e os dois tem que concordar sobre o que e uma entrada valida — validar so na
 * tela deixaria o main aceitando `[NaN, NaN, NaN]` de qualquer caminho novo.
 *
 * Existe para a valvula de escape do 405: quando o WhatsApp passa a recusar a
 * versao que o app anuncia, da para corrigir sem recompilar.
 */

export type WaVersionTuple = [number, number, number]

/** `'2.3000.1035194821'` → tupla. Vazio ou invalido → `null`. */
export function parseWaVersion(input: string): WaVersionTuple | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const parts = trimmed.split('.')
  if (parts.length !== 3) return null

  const nums = parts.map((p) => {
    // `Number('')` e 0 e `Number(' 1 ')` e 1: nenhum dos dois deveria passar.
    if (!/^\d+$/.test(p)) return Number.NaN
    return Number(p)
  })
  if (nums.some((n) => !Number.isSafeInteger(n))) return null
  return nums as WaVersionTuple
}

/** Tupla → texto para o campo. `null` vira string vazia. */
export function formatWaVersion(v: WaVersionTuple | null): string {
  return v ? v.join('.') : ''
}
