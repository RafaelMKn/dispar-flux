import { describe, it, expect } from 'vitest'
import { parseWaVersion, formatWaVersion } from './waVersion'

describe('parseWaVersion', () => {
  it('aceita o formato que o Baileys usa', () => {
    expect(parseWaVersion('2.3000.1035194821')).toEqual([2, 3000, 1035194821])
    expect(parseWaVersion('  2.3000.1  ')).toEqual([2, 3000, 1])
  })

  it('vazio limpa o override', () => {
    expect(parseWaVersion('')).toBeNull()
    expect(parseWaVersion('   ')).toBeNull()
  })

  it('recusa o que nao e tres numeros', () => {
    expect(parseWaVersion('2.3000')).toBeNull()
    expect(parseWaVersion('2.3000.1.4')).toBeNull()
    expect(parseWaVersion('abc')).toBeNull()
    // `Number('')` e 0 e `Number(' 1 ')` e 1 — nenhum dos dois pode passar como
    // versao valida, senao o app anuncia um handshake com lixo.
    expect(parseWaVersion('2..1')).toBeNull()
    expect(parseWaVersion('2. 3000 .1')).toBeNull()
    expect(parseWaVersion('-2.3000.1')).toBeNull()
    expect(parseWaVersion('2.3e3.1')).toBeNull()
  })
})

describe('formatWaVersion', () => {
  it('vai e volta sem perder nada', () => {
    const v = parseWaVersion('2.3000.1035194821')
    expect(formatWaVersion(v)).toBe('2.3000.1035194821')
    expect(formatWaVersion(null)).toBe('')
  })
})
