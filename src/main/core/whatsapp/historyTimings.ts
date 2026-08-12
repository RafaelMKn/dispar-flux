/**
 * Tempos da sincronizacao de historico.
 *
 * Ficam num modulo proprio, e nao junto do `historySync`, por dois motivos: o
 * registro de pedidos pendentes tambem precisa deles (e importar de la criaria
 * ciclo), e o teste precisa encurta-los — o caminho "ainda nao respondeu" so
 * termina depois do prazo, e esperar 90s de verdade em teste nao prova nada
 * alem de paciencia.
 */
export const timings = {
  /**
   * Quanto uma chamada espera a resposta de UM pedido antes de devolver o
   * controle para a tela.
   *
   * Nao e o servidor do WhatsApp que responde: e o aparelho pareado, que monta
   * e sobe um pacote de historico. Isso leva minutos quando leva. Estourar este
   * prazo NAO significa que o celular esta mudo — significa so que nao vamos
   * segurar a tela mais que isso. O pedido continua vivo em `historyRequests` e
   * o lote e creditado quando chegar.
   */
  roundWaitMs: 90_000,

  /**
   * Ate quando um pedido de PRIMEIRO PLANO espera a vez na fila de envio.
   *
   * Generoso porque quem esta esperando e o usuario com a conversa aberta: ele
   * prefere demorar a receber "nao deu".
   */
  queueWaitMs: 120_000,

  /**
   * Idem para a fila de leads, menor de proposito.
   *
   * O trabalho de fundo cede a vez para a tela. Sem essa diferenca os dois
   * disputavam a mesma vaga e um deles voltava de maos vazias sem ter pedido
   * nada — que era como "o celular parou de responder" aparecia sem pedido
   * algum ter saido.
   */
  leadQueueWaitMs: 10_000,

  /** Depois disso um pedido sem resposta e dado por perdido (so no diagnostico). */
  requestTtlMs: 10 * 60_000,

  /** Espera entre tentativas quando a fila recusa a vez. */
  retryMs: 2_000
}
