import { describe, it, expect, beforeAll } from 'vitest'
import { initDb } from '../../db'
import { createContactList } from '../../repos/contactLists'
import { insertContacts, pageContacts, setWaResult } from '../../repos/contacts'
import { addOptOut } from '../../repos/optOuts'
import { getLeadByPhone, listStages, moveLead, stageByRole } from '../../repos/crm'
import { setCrmSettings } from '../../settings'
import { handleInbound, recordCampaignSend } from './leads'

beforeAll(async () => {
  await initDb()
  setCrmSettings({ autoReplyWindowMs: 1000 })
})

let counter = 0

/** Cada teste usa um numero proprio: o banco de teste e compartilhado. */
function freshContact(): { contactId: string; phone: string; jid: string } {
  counter += 1
  const phone = `+55119${String(counter).padStart(8, '0')}`
  const jid = `${phone.replace('+', '')}@s.whatsapp.net`
  const list = createContactList(`Base CRM ${counter}`)
  insertContacts([{ listId: list.id, name: `Lead ${counter}`, phoneE164: phone, extraJson: null }])
  const contact = pageContacts(list.id, {}).rows[0]
  setWaResult(contact.id, true, jid)
  return { contactId: contact.id, phone, jid }
}

function freshJid(): string {
  counter += 1
  return `5511777${String(counter).padStart(6, '0')}@s.whatsapp.net`
}

describe('quem entra no CRM', () => {
  it('ignora mensagem de quem nao esta em base de disparo nenhuma', () => {
    const result = handleInbound(freshJid(), Date.now())
    expect(result.leadId).toBeNull()
    expect(result.movedToActive).toBe(false)
  })

  it('cria lead para quem esta numa base mesmo sem ter recebido disparo', () => {
    const { jid, phone } = freshContact()
    const result = handleInbound(jid, Date.now())

    expect(result.leadId).not.toBeNull()
    const lead = getLeadByPhone(phone)
    expect(lead).toBeDefined()
    // Sem disparo enviado, nao ha `firstSentAt` — e o cron de follow-up depende
    // dele para nao cobrar resposta de quem nunca recebeu nada.
    expect(lead?.firstSentAt).toBeNull()
  })

  it('cria o lead na coluna de entrada quando o disparo sai', () => {
    const { contactId, phone, jid } = freshContact()
    const sentAt = Date.now()
    recordCampaignSend({ contactId, phoneE164: phone, jid, campaignId: 'camp-1', sentAt })

    const lead = getLeadByPhone(phone)
    expect(lead?.stageId).toBe(stageByRole('entry').id)
    expect(lead?.firstSentAt).toBe(sentAt)
    expect(lead?.firstReplyAt).toBeNull()
  })

  it('nao reescreve o primeiro envio num disparo posterior', () => {
    const { contactId, phone, jid } = freshContact()
    const primeiro = Date.now() - 60_000
    recordCampaignSend({ contactId, phoneE164: phone, jid, campaignId: 'c1', sentAt: primeiro })
    recordCampaignSend({ contactId, phoneE164: phone, jid, campaignId: 'c2', sentAt: Date.now() })

    const lead = getLeadByPhone(phone)
    expect(lead?.firstSentAt).toBe(primeiro)
    expect(lead?.campaignId).toBe('c1')
  })
})

describe('primeira resposta move o cartao', () => {
  it('vai para a coluna de em andamento', () => {
    const { contactId, phone, jid } = freshContact()
    const sentAt = Date.now() - 60_000
    recordCampaignSend({ contactId, phoneE164: phone, jid, campaignId: 'camp', sentAt })

    const respondeuEm = Date.now()
    const result = handleInbound(jid, respondeuEm)

    expect(result.movedToActive).toBe(true)
    expect(result.ignoredAsAutomatic).toBe(false)
    const lead = getLeadByPhone(phone)
    expect(lead?.stageId).toBe(stageByRole('active').id)
    expect(lead?.firstReplyAt).toBe(respondeuEm)
  })

  it('a segunda resposta nao move de novo nem reescreve a primeira', () => {
    const { contactId, phone, jid } = freshContact()
    recordCampaignSend({
      contactId,
      phoneE164: phone,
      jid,
      campaignId: 'camp',
      sentAt: Date.now() - 60_000
    })

    const primeira = Date.now() - 30_000
    handleInbound(jid, primeira)

    // Move a mao para outra coluna: uma segunda mensagem nao pode puxar o lead
    // de volta para "em andamento" e desfazer o trabalho do usuario.
    const outraColuna = listStages().find((s) => s.role === null)
    expect(outraColuna).toBeDefined()
    moveLead(getLeadByPhone(phone)!.id, outraColuna!.id)

    const segunda = handleInbound(jid, Date.now())
    expect(segunda.movedToActive).toBe(false)

    const lead = getLeadByPhone(phone)
    expect(lead?.firstReplyAt).toBe(primeira)
    expect(lead?.stageId).toBe(outraColuna!.id)
  })

  it('registra o lead mesmo com opt-out, para o historico nao sumir', () => {
    const { contactId, phone, jid } = freshContact()
    recordCampaignSend({
      contactId,
      phoneE164: phone,
      jid,
      campaignId: 'camp',
      sentAt: Date.now() - 60_000
    })
    addOptOut(phone, 'teste')

    const result = handleInbound(jid, Date.now())
    expect(result.movedToActive).toBe(true)
  })
})

describe('janela anti-resposta-automatica', () => {
  it('descarta a resposta que volta junto com o envio', () => {
    const { contactId, phone, jid } = freshContact()
    const sentAt = Date.now()
    recordCampaignSend({ contactId, phoneE164: phone, jid, campaignId: 'camp', sentAt })

    const result = handleInbound(jid, sentAt + 300)

    expect(result.ignoredAsAutomatic).toBe(true)
    expect(result.movedToActive).toBe(false)
    const lead = getLeadByPhone(phone)
    expect(lead?.firstReplyAt).toBeNull()
    expect(lead?.stageId).toBe(stageByRole('entry').id)
    expect(lead?.ignoredAutoReplies).toBe(1)
  })

  it('aceita a resposta que chega depois da janela', () => {
    const { contactId, phone, jid } = freshContact()
    const sentAt = Date.now()
    recordCampaignSend({ contactId, phoneE164: phone, jid, campaignId: 'camp', sentAt })

    const result = handleInbound(jid, sentAt + 1500)

    expect(result.ignoredAsAutomatic).toBe(false)
    expect(result.movedToActive).toBe(true)
  })

  it('a resposta de verdade depois da automatica ainda move o cartao', () => {
    const { contactId, phone, jid } = freshContact()
    const sentAt = Date.now()
    recordCampaignSend({ contactId, phoneE164: phone, jid, campaignId: 'camp', sentAt })

    handleInbound(jid, sentAt + 200) // ausencia automatica
    const result = handleInbound(jid, sentAt + 90_000) // a pessoa de verdade

    expect(result.movedToActive).toBe(true)
    const lead = getLeadByPhone(phone)
    expect(lead?.ignoredAutoReplies).toBe(1)
    expect(lead?.firstReplyAt).toBe(sentAt + 90_000)
  })

  it('respeita a janela desligada (0 ms)', () => {
    setCrmSettings({ autoReplyWindowMs: 0 })
    const { contactId, phone, jid } = freshContact()
    const sentAt = Date.now()
    recordCampaignSend({ contactId, phoneE164: phone, jid, campaignId: 'camp', sentAt })

    const result = handleInbound(jid, sentAt + 10)
    expect(result.ignoredAsAutomatic).toBe(false)
    expect(result.movedToActive).toBe(true)
    setCrmSettings({ autoReplyWindowMs: 1000 })
  })
})
