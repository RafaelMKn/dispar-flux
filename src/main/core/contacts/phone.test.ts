import { describe, it, expect } from 'vitest'
import { normalizePhone, toWaNumber } from './phone'

describe('normalizePhone', () => {
  it('normaliza celular brasileiro em formatos variados para o mesmo E.164', () => {
    const esperado = '+5511987654210'
    for (const entrada of [
      '(11) 98765-4210',
      '11987654210',
      '11 98765 4210',
      '5511987654210',
      '+55 11 98765-4210',
      '+5511987654210'
    ]) {
      expect(normalizePhone(entrada), entrada).toBe(esperado)
    }
  })

  it('aceita fixo brasileiro (8 digitos, sem o 9)', () => {
    expect(normalizePhone('(11) 3255-4210')).toBe('+551132554210')
  })

  it('respeita numero internacional com DDI explicito', () => {
    expect(normalizePhone('+1 415 555 2671')).toBe('+14155552671')
  })

  it('rejeita entradas invalidas', () => {
    for (const entrada of [
      '',
      '   ',
      'nao tenho',
      '123',
      '11987654210 ramal 3',
      'abc11987654210'
    ]) {
      expect(normalizePhone(entrada), entrada).toBeNull()
    }
  })

  it('nao inventa nem remove o 9o digito', () => {
    // 10 digitos com prefixo de celular antigo: se a lib considerar invalido,
    // devolvemos null em vez de "consertar" e arriscar o numero errado.
    const r = normalizePhone('1187654210')
    expect(r === null || r === '+551187654210').toBe(true)
  })
})

describe('toWaNumber', () => {
  it('remove o + e a pontuacao', () => {
    expect(toWaNumber('+5511987654210')).toBe('5511987654210')
  })
})
