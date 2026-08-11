/**
 * Fila serial com folga entre as tarefas.
 *
 * PORQUE ISTO EXISTE: o pedido de historico antigo precisa sair um por vez e
 * com espaco entre um e outro — rajada de requisicao e o padrao de trafego que
 * faz o numero ser bloqueado. Ate aqui isso era um booleano (`historyRequestInFlight`)
 * levantado no envio e baixado por um `setTimeout` de 3s. Duas coisas quebravam:
 *
 * 1. O booleano descia 3s depois do ENVIO, mas a rodada continuava esperando a
 *    resposta por ate 45s. Nesse intervalo qualquer outro pedido passava — ou
 *    seja, a folga nao era folga.
 * 2. Quem chegava com o booleano levantado era RECUSADO ('cooldown'), nao
 *    enfileirado. A tela e a fila de leads disputavam a mesma vaga e se matavam
 *    de fome: a conversa aberta pelo usuario voltava "nada novo veio desta vez"
 *    sem ter pedido nada.
 *
 * Aqui quem chega ENTRA NA FILA e espera a vez. Cada chamador decide quanto
 * tempo aceita esperar (`waitMs`), e e assim que a prioridade acontece sem
 * precisar de niveis: a tela espera bastante, o trabalho de fundo desiste
 * rapido e cede o lugar.
 *
 * Modulo puro de proposito — sem Electron, sem Baileys — para o teste conseguir
 * exercitar a disciplina de espaçamento com relogio falso.
 */

export type QueueResult<T> = { ok: true; value: T } | { ok: false; reason: 'busy' }

interface Waiter {
  /** Solta a vez para este chamador. */
  start: () => void
  /** Avisa que ele desistiu de esperar. */
  giveUp: () => void
  waitTimer: ReturnType<typeof setTimeout> | null
  done: boolean
}

export class SerialQueue {
  /**
   * Folga MINIMA entre o fim de uma tarefa e o inicio da proxima.
   *
   * Contada do fim, e nao do inicio: uma tarefa que demora nao "consome" a
   * folga da seguinte, que e justamente o que o booleano antigo fazia.
   */
  private readonly gapMs: number

  private running = false
  private lastFinishedAt = 0
  private readonly waiters: Waiter[] = []

  constructor(opts: { gapMs: number }) {
    this.gapMs = opts.gapMs
  }

  /** Quantos chamadores estao esperando a vez agora (sem contar o que roda). */
  get depth(): number {
    return this.waiters.length
  }

  /** Alguma tarefa esta em execucao neste instante? */
  get busy(): boolean {
    return this.running
  }

  /**
   * Entra na fila e roda `fn` quando a vez chegar.
   *
   * Devolve `{ ok: false, reason: 'busy' }` quando a vez nao chegou dentro de
   * `waitMs`. `waitMs: 0` significa "agora ou nunca" — usado pela rolagem da
   * conversa, onde esperar seria pior que nao fazer nada.
   */
  async run<T>(fn: () => Promise<T>, waitMs: number): Promise<QueueResult<T>> {
    const got = await this.acquire(waitMs)
    if (!got) return { ok: false, reason: 'busy' }

    try {
      const value = await fn()
      return { ok: true, value }
    } finally {
      this.running = false
      this.lastFinishedAt = Date.now()
      this.pump()
    }
  }

  /** Espera a vez. `false` = desistiu antes de conseguir. */
  private acquire(waitMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const waiter: Waiter = {
        done: false,
        waitTimer: null,
        start: () => {
          if (waiter.done) return
          waiter.done = true
          if (waiter.waitTimer) clearTimeout(waiter.waitTimer)
          this.running = true
          resolve(true)
        },
        giveUp: () => {
          if (waiter.done) return
          waiter.done = true
          const i = this.waiters.indexOf(waiter)
          if (i >= 0) this.waiters.splice(i, 1)
          resolve(false)
        }
      }

      this.waiters.push(waiter)

      /**
       * O prazo comeca a contar ANTES do `pump`.
       *
       * Com `waitMs: 0` e a fila livre, o `pump` abaixo ainda pode agendar uma
       * espera pela folga entre tarefas — e nesse caso desistir e o
       * comportamento certo: quem passou 0 disse que nao espera.
       */
      if (waitMs <= 0) {
        this.pump()
        waiter.giveUp()
        return
      }
      waiter.waitTimer = setTimeout(() => waiter.giveUp(), waitMs)
      this.pump()
    })
  }

  /** Timer da folga entre tarefas, para nao agendar dois. */
  private gapTimer: ReturnType<typeof setTimeout> | null = null

  /** Solta o proximo da fila, respeitando a folga desde a ultima tarefa. */
  private pump(): void {
    if (this.running) return
    const next = this.waiters[0]
    if (!next) return

    const since = Date.now() - this.lastFinishedAt
    const wait = this.lastFinishedAt === 0 ? 0 : Math.max(0, this.gapMs - since)
    if (wait > 0) {
      if (this.gapTimer) return
      this.gapTimer = setTimeout(() => {
        this.gapTimer = null
        this.pump()
      }, wait)
      return
    }

    this.waiters.shift()
    next.start()
  }
}
