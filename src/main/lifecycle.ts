/**
 * "O app esta encerrando de verdade?"
 *
 * PORQUE EXISTE COMO MODULO PROPRIO: com fechar-para-bandeja ligado, o handler
 * de `close` da janela cancela o fechamento e esconde o app. Isso precisa valer
 * so para o usuario clicando no X — nunca para um encerramento real, senao o
 * app viraria um processo impossivel de fechar.
 *
 * Quem precisa marcar isso e o processo principal E o updater (que reinicia o
 * app por um caminho proprio, fora do fluxo normal de saida). Uma variavel em
 * qualquer um dos dois criaria import circular; por isso a bandeira mora aqui.
 */

let quitting = false

/** Marca que o encerramento e intencional. Nao ha volta: so se chama ao sair. */
export function beginQuit(): void {
  quitting = true
}

export function isQuitting(): boolean {
  return quitting
}

/**
 * O clique no X deve esconder a janela em vez de fechar?
 *
 * Vive aqui, separado do handler de `close`, para a regra ser testavel: os dois
 * jeitos de errar sao caros — deixar passar mata um disparo em andamento, e
 * segurar demais faz um app que nao fecha nunca.
 */
export function shouldHideOnClose(closeToTray: boolean): boolean {
  return closeToTray && !quitting
}
