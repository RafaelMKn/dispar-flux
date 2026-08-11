import { describe, it, expect, vi, afterEach } from 'vitest'
import { MemoryCache } from './memoryCache'

afterEach(() => {
  vi.useRealTimers()
})

describe('MemoryCache', () => {
  it('guarda e devolve pela chave', () => {
    const c = new MemoryCache({ ttlMs: 1000 })
    c.set('a', 7)
    expect(c.get<number>('a')).toBe(7)
    expect(c.get('inexistente')).toBeUndefined()
  })

  it('esquece depois do prazo', () => {
    vi.useFakeTimers()
    const c = new MemoryCache({ ttlMs: 1000 })
    c.set('a', 'x')

    vi.advanceTimersByTime(999)
    expect(c.get('a')).toBe('x')

    vi.advanceTimersByTime(2)
    expect(c.get('a')).toBeUndefined()
    // E some do mapa, nao so da leitura: senao o teto de entradas seria gasto
    // com lixo vencido.
    expect(c.size).toBe(0)
  })

  it('renova o prazo ao regravar a mesma chave', () => {
    vi.useFakeTimers()
    const c = new MemoryCache({ ttlMs: 1000 })
    c.set('a', 1)
    vi.advanceTimersByTime(800)
    c.set('a', 2)
    vi.advanceTimersByTime(800)
    expect(c.get('a')).toBe(2)
  })

  it('respeita o teto descartando a entrada mais antiga', () => {
    const c = new MemoryCache({ ttlMs: 10_000, maxEntries: 2 })
    c.set('a', 1)
    c.set('b', 2)
    c.set('c', 3)

    expect(c.get('a')).toBeUndefined()
    expect(c.get('b')).toBe(2)
    expect(c.get('c')).toBe(3)
    expect(c.size).toBe(2)
  })

  it('regravar uma chave existente no teto nao descarta ninguem', () => {
    const c = new MemoryCache({ ttlMs: 10_000, maxEntries: 2 })
    c.set('a', 1)
    c.set('b', 2)
    c.set('a', 9)

    expect(c.get('a')).toBe(9)
    expect(c.get('b')).toBe(2)
  })

  it('del e flushAll limpam', () => {
    const c = new MemoryCache({ ttlMs: 10_000 })
    c.set('a', 1)
    c.set('b', 2)
    c.del('a')
    expect(c.get('a')).toBeUndefined()
    expect(c.get('b')).toBe(2)

    c.flushAll()
    expect(c.size).toBe(0)
  })
})
