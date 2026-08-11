import { describe, it, expect, vi, afterEach } from 'vitest'
import { SerialQueue } from './requestQueue'

/**
 * O que importa aqui e a DISCIPLINA da fila: uma tarefa por vez, folga contada
 * do FIM de uma ate o inicio da proxima, e quem nao pode esperar recebe uma
 * recusa explicita em vez de furar a fila.
 *
 * Relogio falso porque esperar 3s de verdade em teste nao prova nada.
 */

afterEach(() => {
  vi.useRealTimers()
})

/** Deixa os timers agendados rodarem e as promises resolverem. */
async function avanca(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('SerialQueue', () => {
  it('roda uma tarefa por vez, na ordem de chegada', async () => {
    vi.useFakeTimers()
    const fila = new SerialQueue({ gapMs: 1000 })
    const ordem: string[] = []

    const primeira = deferred()
    const a = fila.run(async () => {
      ordem.push('a:inicio')
      await primeira.promise
      ordem.push('a:fim')
    }, 60_000)
    const b = fila.run(async () => {
      ordem.push('b:inicio')
    }, 60_000)

    await avanca(0)
    // A segunda nao pode ter comecado enquanto a primeira nao terminou.
    expect(ordem).toEqual(['a:inicio'])
    expect(fila.depth).toBe(1)

    primeira.resolve()
    await avanca(1000)
    await Promise.all([a, b])
    expect(ordem).toEqual(['a:inicio', 'a:fim', 'b:inicio'])
  })

  it('respeita a folga entre o FIM de uma tarefa e o inicio da proxima', async () => {
    vi.useFakeTimers()
    const fila = new SerialQueue({ gapMs: 3000 })
    const marcos: number[] = []

    // A primeira demora 5s: a folga da segunda so comeca depois disso, e nao
    // em paralelo. Era exatamente aqui que o booleano antigo errava.
    const a = fila.run(async () => {
      await new Promise((r) => setTimeout(r, 5000))
      marcos.push(Date.now())
    }, 60_000)
    const b = fila.run(async () => {
      marcos.push(Date.now())
    }, 60_000)

    const inicio = Date.now()
    await avanca(5000)
    expect(marcos).toHaveLength(1)

    await avanca(2999)
    expect(marcos).toHaveLength(1)

    await avanca(1)
    await Promise.all([a, b])
    expect(marcos).toHaveLength(2)
    expect(marcos[1] - inicio).toBe(8000)
  })

  it('devolve busy quando a vez nao chega dentro do prazo', async () => {
    vi.useFakeTimers()
    const fila = new SerialQueue({ gapMs: 0 })
    const segura = deferred()

    const a = fila.run(() => segura.promise, 60_000)
    await avanca(0)

    const b = fila.run(async () => 'nao deveria rodar', 500)
    await avanca(500)
    expect(await b).toEqual({ ok: false, reason: 'busy' })
    expect(fila.depth).toBe(0)

    segura.resolve()
    await avanca(0)
    await a
  })

  it('waitMs 0 e "agora ou nunca": recusa se a vaga esta ocupada', async () => {
    vi.useFakeTimers()
    const fila = new SerialQueue({ gapMs: 0 })
    const segura = deferred()
    const a = fila.run(() => segura.promise, 60_000)
    await avanca(0)

    const b = await fila.run(async () => 'x', 0)
    expect(b).toEqual({ ok: false, reason: 'busy' })

    segura.resolve()
    await avanca(0)
    await a
  })

  it('waitMs 0 roda na hora quando a fila esta livre', async () => {
    vi.useFakeTimers()
    const fila = new SerialQueue({ gapMs: 3000 })
    const r = await fila.run(async () => 'ok', 0)
    expect(r).toEqual({ ok: true, value: 'ok' })
  })

  it('a fila continua andando quando uma tarefa falha', async () => {
    vi.useFakeTimers()
    const fila = new SerialQueue({ gapMs: 0 })
    const a = fila.run(async () => {
      throw new Error('boom')
    }, 60_000)
    const b = fila.run(async () => 'depois', 60_000)

    await expect(a).rejects.toThrow('boom')
    await avanca(0)
    expect(await b).toEqual({ ok: true, value: 'depois' })
  })

  it('quem desiste sai da fila e nao segura os que vem atras', async () => {
    vi.useFakeTimers()
    const fila = new SerialQueue({ gapMs: 0 })
    const segura = deferred()
    const a = fila.run(() => segura.promise, 60_000)
    await avanca(0)

    const desistente = fila.run(async () => 'nao', 100)
    const paciente = fila.run(async () => 'sim', 60_000)
    await avanca(100)
    expect(await desistente).toEqual({ ok: false, reason: 'busy' })
    expect(fila.depth).toBe(1)

    segura.resolve()
    await avanca(0)
    await a
    expect(await paciente).toEqual({ ok: true, value: 'sim' })
  })
})
