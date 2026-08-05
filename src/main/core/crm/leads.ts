import { EventEmitter } from 'node:events'
import {
  ensureLead,
  getLeadByJid,
  getLeadByPhone,
  stageByRole,
  updateLead,
  type LeadRow
} from '../../repos/crm'
import { findContactByPhone } from '../../repos/contacts'
import { getCrmSettings } from '../../settings'
import { jidToE164 } from '../whatsapp/optOutDetect'
import { scoped } from '../../logger'
import { isAutomaticReply } from './rules'

const log = scoped('crm')

/** Emite 'changed' quando o kanban precisa recarregar. */
export const crmEvents = new EventEmitter()

/**
 * Registra que o disparo saiu para um contato.
 *
 * Chamado pelo motor de disparo logo depois de o envio ser confirmado. E este
 * ponto que cria o cartao no kanban e marca o instante que a janela
 * anti-resposta-automatica usa como referencia.
 */
export function recordCampaignSend(input: {
  contactId: string
  phoneE164: string
  jid: string
  campaignId: string
  sentAt: number
}): void {
  const lead = ensureLead({
    phoneE164: input.phoneE164,
    contactId: input.contactId,
    jid: input.jid,
    campaignId: input.campaignId
  })

  updateLead(lead.id, {
    lastOutboundAt: input.sentAt,
    // `firstSentAt` marca o inicio do relacionamento e nunca e reescrito: e a
    // partir dele que a tela mostra ha quanto tempo o lead esta parado.
    ...(lead.firstSentAt == null ? { firstSentAt: input.sentAt } : {})
  })
  crmEvents.emit('changed')
}

/**
 * Acha o lead de um JID, criando um se a pessoa esta numa base de disparo.
 *
 * Devolve null para quem nao esta em base nenhuma — e a regra "ignorar mensagens
 * de quem nao esta em qualquer base de disparo". Sem isso o kanban viraria um
 * espelho da agenda do celular: qualquer conhecido que mandasse "oi" apareceria
 * como lead.
 */
function resolveLead(jid: string): LeadRow | null {
  const byJid = getLeadByJid(jid)
  if (byJid) return byJid

  const phone = jidToE164(jid)
  if (!phone) return null

  // Lead criado antes de a base ser validada pode nao ter jid gravado ainda.
  const byPhone = getLeadByPhone(phone)
  if (byPhone) {
    if (!byPhone.jid) updateLead(byPhone.id, { jid })
    return { ...byPhone, jid: byPhone.jid ?? jid }
  }

  const contact = findContactByPhone(phone)
  if (!contact) return null

  // Esta na base mas ainda nao recebeu disparo (respondeu antes, ou foi
  // importado depois). Vira lead na coluna de entrada, sem `firstSentAt` — o
  // cron de follow-up ignora quem nunca recebeu nada.
  return ensureLead({ phoneE164: phone, contactId: contact.id, jid })
}

export interface InboundResult {
  /** null quando a mensagem foi ignorada (fora de qualquer base). */
  leadId: string | null
  /** true quando a mensagem caiu na janela anti-resposta-automatica. */
  ignoredAsAutomatic: boolean
  /** true quando esta foi a primeira resposta e o cartao mudou de coluna. */
  movedToActive: boolean
}

/**
 * Processa uma mensagem RECEBIDA para efeito de CRM.
 *
 * `receivedAt` tem de ser o instante em que o app processou a mensagem, e nao o
 * `messageTimestamp` do WhatsApp — ver a explicacao em `rules.ts`.
 *
 * Nunca lanca: uma falha aqui nao pode impedir a mensagem de aparecer na inbox.
 */
export function handleInbound(jid: string, receivedAt: number): InboundResult {
  const idle: InboundResult = { leadId: null, ignoredAsAutomatic: false, movedToActive: false }
  try {
    const lead = resolveLead(jid)
    if (!lead) return idle

    const reference = lead.lastOutboundAt ?? lead.firstSentAt
    const { autoReplyWindowMs } = getCrmSettings()

    if (isAutomaticReply(reference, receivedAt, autoReplyWindowMs)) {
      // Contabiliza e sai: a mensagem continua na conversa normalmente, so nao
      // conta como o cliente ter respondido.
      updateLead(lead.id, { ignoredAutoReplies: lead.ignoredAutoReplies + 1 })
      log.info('resposta descartada como automatica', {
        jid,
        msDepoisDoEnvio: reference ? receivedAt - reference : null,
        janelaMs: autoReplyWindowMs
      })
      crmEvents.emit('changed')
      return { leadId: lead.id, ignoredAsAutomatic: true, movedToActive: false }
    }

    const isFirstReply = lead.firstReplyAt == null
    updateLead(lead.id, {
      lastInboundAt: receivedAt,
      ...(isFirstReply ? { firstReplyAt: receivedAt, stageId: stageByRole('active').id } : {})
    })

    if (isFirstReply) {
      log.info('lead respondeu pela primeira vez; movido para em andamento', {
        jid,
        leadId: lead.id
      })
    }
    crmEvents.emit('changed')
    return { leadId: lead.id, ignoredAsAutomatic: false, movedToActive: isFirstReply }
  } catch (e) {
    log.error('falha ao processar resposta no CRM', e)
    return idle
  }
}
