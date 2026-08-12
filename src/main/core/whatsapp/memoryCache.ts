/**
 * Cache em memoria com TTL, no formato que o Baileys espera (`CacheStore`).
 *
 * PORQUE ESCREVER EM VEZ DE INSTALAR: o Baileys usa `node-cache` nos exemplos,
 * mas a unica coisa que precisamos dele e um Map com prazo de validade. A lista
 * de `dependencies` deste app e curta de proposito — cada pacote novo entra no
 * instalador do Windows e vira superficie de manutencao.
 *
 * Serve ao `msgRetryCounterCache`: quando o aparelho do contato nao consegue
 * decifrar uma mensagem, ele pede reenvio, e sem contar quantas vezes ja
 * tentamos o app pode ficar reenviando a mesma mensagem indefinidamente.
 */

interface Entry {
  value: unknown
  expiresAt: number
}

export class MemoryCache {
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly map = new Map<string, Entry>()

  constructor(opts: { ttlMs: number; maxEntries?: number }) {
    this.ttlMs = opts.ttlMs
    this.maxEntries = opts.maxEntries ?? 1000
  }

  get<T>(key: string): T | undefined {
    const hit = this.map.get(key)
    if (!hit) return undefined
    if (hit.expiresAt <= Date.now()) {
      this.map.delete(key)
      return undefined
    }
    return hit.value as T
  }

  set<T>(key: string, value: T): void {
    /**
     * Teto de entradas, senao um app aberto por semanas acumula um contador por
     * mensagem que ja passou. Descartamos a mais antiga por ordem de insercao —
     * o Map do JS preserva essa ordem, e para contadores de retry ela e um
     * proxy honesto de "a que menos importa agora".
     */
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      const oldest = this.map.keys().next()
      if (!oldest.done) this.map.delete(oldest.value)
    }
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  del(key: string): void {
    this.map.delete(key)
  }

  flushAll(): void {
    this.map.clear()
  }

  /** Entradas ainda validas. Usado no diagnostico e nos testes. */
  get size(): number {
    const now = Date.now()
    let n = 0
    for (const [key, entry] of this.map) {
      if (entry.expiresAt <= now) this.map.delete(key)
      else n += 1
    }
    return n
  }
}
