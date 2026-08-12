import { pnForLid, rememberLid, normalizeLid } from '../../repos/lidMap'

/**
 * Traducao do endereçamento LID do WhatsApp para o telefone.
 *
 * O QUE MUDOU DO LADO DELES: as conversas estao deixando de ser endereçadas
 * pelo numero (`555184579349@s.whatsapp.net`) e passando a usar um LID
 * (`71700301529149@lid`), um identificador opaco que nao tem relacao aritmetica
 * nenhuma com o telefone.
 *
 * O QUE ISSO QUEBRAVA AQUI: o app usa o jid como chave da conversa E como
 * ligacao com a base de leads (casamento pelos ultimos 8 digitos do telefone).
 * Com LID, a mesma pessoa virava DUAS conversas — uma criada pelo disparo, pelo
 * numero, e outra criada pela resposta dela, pelo LID — e a do LID nunca casava
 * com a base, entao saia da fila de sincronizacao e nao movia o cartao no CRM.
 *
 * A REGRA: o telefone e a chave canonica, sempre. O LID e guardado a parte
 * (`chats.lid`) porque quem fala com o servidor precisa usar o endereco que ELE
 * usa — ver o comentario da coluna no schema.
 */

/** Este jid usa o endereçamento novo? */
export function isLid(jid: string | null | undefined): boolean {
  return Boolean(jid?.endsWith('@lid'))
}

/**
 * O jid canonico (telefone) para este endereco, ou `null` se nao soubermos.
 *
 * DUAS FONTES, e as duas ja existem no Baileys 6.7.23:
 *
 * 1. `senderPn`, que vem junto da chave da mensagem. Cobre so o que RECEBEMOS —
 *    mensagem `fromMe` nao traz esse campo, e no log real do usuario 29 dos 46
 *    LIDs so apareciam assim. Por isso o par e gravado assim que aparece: uma
 *    mensagem nossa que chegue depois ja encontra a traducao pronta.
 * 2. O mapa gravado (`lid_map`), alimentado pelo item 1 e pela consulta USync
 *    que o `onWhatsApp` ja faz ao validar numeros.
 *
 * Devolver `null` e um resultado legitimo e o chamador precisa trata-lo: e o
 * caso de um LID que ainda nao sabemos de quem e. Inventar uma conversa com o
 * LID cru e exatamente o que produzia a duplicata.
 */
export function canonicalJid(
  jid: string | null | undefined,
  hints: { senderPn?: string | null } = {}
): string | null {
  if (!jid) return null
  if (!isLid(jid)) return jid

  const senderPn = hints.senderPn
  if (senderPn && !isLid(senderPn)) {
    // Aprende antes de usar: e o que faz a proxima mensagem `fromMe` desta
    // mesma conversa — que nao traz `senderPn` — ser resolvida.
    rememberLid(jid, senderPn, 'senderPn')
    return senderPn
  }

  // `pnForLid` ja normaliza o sufixo de dispositivo: `x:23@lid` e `x@lid` sao a
  // mesma pessoa, e no log real 7 dos 46 LIDs aparecem nas duas formas.
  return pnForLid(jid)
}

/**
 * Colhe o par LID -> telefone que vem de graca numa mensagem de GRUPO.
 *
 * Mensagem de grupo traz `participant` (o LID de quem falou) e `participantPn`
 * (o telefone) na mesma chave. O grupo em si continua sendo descartado — e ruido
 * para uma ferramenta de prospeccao —, mas jogar o PAR fora junto era desperdicio:
 * no log real sao 42 pares distintos, contra 17 que o `senderPn` de conversa 1:1
 * resolve. Quem estiver num grupo com o usuario passa a ter a conversa direta ja
 * traduzida na primeira mensagem.
 */
export function harvestGroupLid(key: {
  participant?: string | null
  participantPn?: string | null
}): void {
  const { participant, participantPn } = key
  if (!participant || !participantPn) return
  if (!isLid(participant) || isLid(participantPn)) return
  rememberLid(participant, participantPn, 'senderPn')
}

export { normalizeLid }
