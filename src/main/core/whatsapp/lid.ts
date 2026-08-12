import { pnForLid, rememberLid, normalizeLid, type LidSource } from '../../repos/lidMap'

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
 *
 * ISTO CONTINUA SENDO NOSSO no Baileys 7.x. O `LIDMappingStore` que veio com ele
 * guarda os pares para o Signal conseguir decifrar, e nao tem opiniao nenhuma
 * sobre qual endereco vira a CHAVE da conversa aqui dentro — essa escolha e de
 * produto, e e ela que mantem a conversa unica e casada com a base de leads.
 */

/**
 * Este jid usa o endereçamento novo?
 *
 * Mesma regra do `isLidUser` do Baileys (`WABinary/jid-utils`): sufixo `@lid`
 * exato. `@hosted.lid` e OUTRO servidor e de proposito NAO cai aqui — ver
 * `isPhoneJid`.
 */
export function isLid(jid: string | null | undefined): boolean {
  return Boolean(jid?.endsWith('@lid'))
}

/**
 * Este jid e mesmo um telefone?
 *
 * PORQUE NAO BASTA "nao e LID": o Baileys 7.x tem quatro servidores de usuario
 * (`s.whatsapp.net`, `lid`, `hosted`, `hosted.lid`), e o endereco alternativo
 * que ele entrega pode vir como `@hosted.lid`. Aquilo nao termina em `@lid`,
 * entao a guarda antiga (`!isLid(...)`) deixaria passar um identificador opaco
 * para o lugar do numero — e a chave da conversa e exatamente o que nao pode
 * receber lixo, porque e ela que casa com a base de leads.
 *
 * Aceitar so o que e reconhecidamente telefone erra para o lado seguro: no pior
 * caso a conversa fica sem traducao por enquanto (resultado que `canonicalJid`
 * ja sabe tratar) em vez de ganhar uma traducao errada para sempre.
 */
function isPhoneJid(jid: string | null | undefined): boolean {
  return Boolean(jid?.endsWith('@s.whatsapp.net'))
}

/**
 * Grava um par LID -> telefone vindo de fora, com a direcao conferida.
 *
 * PORQUE CENTRALIZADO: o Baileys 7.x oferece o par por quatro caminhos — o
 * endereco alternativo do envelope, o evento `lid-mapping.update`, o
 * `lidPnMappings` do lote de historico e os campos `lid`/`phoneNumber` do
 * contato. Cada um deles ja chegou aqui com os lados trocados em algum
 * momento da migracao, e repetir a checagem em quatro lugares e como um
 * deles acabaria divergindo.
 *
 * Devolve se o par foi aceito — quem varre lotes usa isso para contar.
 */
export function learnLidPair(
  lid: string | null | undefined,
  pn: string | null | undefined,
  source: LidSource
): boolean {
  if (!lid || !pn) return false
  if (!isLid(lid) || !isPhoneJid(pn)) return false
  rememberLid(lid, pn, source)
  return true
}

/**
 * O jid canonico (telefone) para este endereco, ou `null` se nao soubermos.
 *
 * DUAS FONTES:
 *
 * 1. O ENDEREÇO ALTERNATIVO que vem junto da chave da mensagem (`alt`). No
 *    Baileys 7.x ele chega em `key.remoteJidAlt` (conversa 1:1) ou
 *    `key.participantAlt` (grupo); ate o 6.7.23 eram dois campos de mao unica,
 *    `senderPn` e `participantPn`. O par e gravado assim que aparece: uma
 *    mensagem nossa que chegue depois — e as `fromMe` costumam vir sem o
 *    alternativo — ja encontra a traducao pronta.
 * 2. O mapa gravado (`lid_map`), alimentado pelo item 1, pelo evento
 *    `lid-mapping.update` e pela varredura do `sweepLids`.
 *
 * O `alt` E BIDIRECIONAL, e e por isso que este modulo checa o FORMATO dos dois
 * lados em vez de confiar num campo so. O Baileys preenche o alternativo com o
 * *outro* endereco da conversa: quando ela vem por LID, o alternativo e o
 * telefone; quando vem pelo telefone, o alternativo e o LID. Ler o segundo caso
 * como se fosse o primeiro gravaria um LID na coluna do numero — uma duplicata
 * ao contrario, pior que a original porque suja o banco.
 *
 * Devolver `null` e um resultado legitimo e o chamador precisa trata-lo: e o
 * caso de um LID que ainda nao sabemos de quem e. Inventar uma conversa com o
 * LID cru e exatamente o que produzia a duplicata.
 */
export function canonicalJid(
  jid: string | null | undefined,
  hints: { alt?: string | null } = {}
): string | null {
  if (!jid) return null

  const alt = hints.alt

  if (!isLid(jid)) {
    /**
     * Conversa endereçada pelo TELEFONE — a chave ja esta certa.
     *
     * O que o 7.x acrescenta e o brinde: aqui o alternativo e o LID DESTA
     * conversa, dito pelo servidor. O 6.7.23 nunca entregou isso, e era
     * justamente o buraco que o `sweepLids` precisa consultar o servidor para
     * tapar — conversa em que so disparamos e nunca recebemos nada.
     */
    if (isPhoneJid(jid) && isLid(alt)) rememberLid(alt!, jid, 'senderPn')
    return jid
  }

  // Daqui para baixo a conversa vem por LID e precisamos achar o telefone.
  if (isPhoneJid(alt)) {
    // Aprende antes de usar: e o que faz a proxima mensagem `fromMe` desta
    // mesma conversa — que costuma vir sem o alternativo — ser resolvida.
    rememberLid(jid, alt!, 'senderPn')
    return alt!
  }

  // `pnForLid` ja normaliza o sufixo de dispositivo: `x:23@lid` e `x@lid` sao a
  // mesma pessoa, e no log real 7 dos 46 LIDs aparecem nas duas formas.
  return pnForLid(jid)
}

/**
 * Colhe o par LID -> telefone que vem de graca numa mensagem de GRUPO.
 *
 * Mensagem de grupo traz `participant` (quem falou) e `participantAlt` (o outro
 * endereco da mesma pessoa) na mesma chave. O grupo em si continua sendo
 * descartado — e ruido para uma ferramenta de prospeccao —, mas jogar o PAR fora
 * junto era desperdicio: no log real sao 42 pares distintos, contra 17 que a
 * conversa 1:1 resolve. Quem estiver num grupo com o usuario passa a ter a
 * conversa direta ja traduzida na primeira mensagem.
 *
 * Vale aqui a mesma bidirecionalidade do `canonicalJid`: dependendo de como o
 * grupo endereça os participantes, o par pode chegar em qualquer ordem, entao
 * quem e LID e quem e telefone se decide pelo formato, nunca pela posicao.
 */
export function harvestGroupLid(key: {
  participant?: string | null
  participantAlt?: string | null
}): void {
  const { participant, participantAlt } = key
  if (!participant || !participantAlt) return

  if (isLid(participant) && isPhoneJid(participantAlt)) {
    rememberLid(participant, participantAlt, 'senderPn')
    return
  }
  if (isPhoneJid(participant) && isLid(participantAlt)) {
    rememberLid(participantAlt, participant, 'senderPn')
  }
}

export { normalizeLid, isPhoneJid }
