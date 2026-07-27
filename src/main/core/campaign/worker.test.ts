import { describe, it, expect, beforeAll } from 'vitest'
import { initDb } from '../../db'
import { createContactList } from '../../repos/contactLists'
import { insertContacts, pageContacts, setWaResult, setOptOut } from '../../repos/contacts'
import { addOptOut } from '../../repos/optOuts'
import {
  createCampaign,
  enqueueJobs,
  campaignProgress,
  reconcileStuckJobs,
  markJobSending,
  nextPendingJob,
  jobsByStatus,
  sentToday
} from '../../repos/campaigns'
import { campaignRunner, type Sender } from './worker'
import type { SendingDefaults } from '@shared/types'

/** Pacing zerado: o teste nao pode esperar segundos de verdade. */
const FAST: SendingDefaults = {
  delayMinMs: 0,
  delayMaxMs: 0,
  restEveryN: 0,
  restDurationMs: 0,
  dailyCap: 0
}

function makeSender(over: Partial<Sender> = {}): Sender & { enviados: string[] } {
  const enviados: string[] = []
  return {
    enviados,
    isReady: () => true,
    sendTyping: async () => {},
    sendText: async (jid: string) => {
      enviados.push(jid)
      return `wamid-${enviados.length}`
    },
    ...over
  }
}

// Cada base usa um bloco proprio de numeros. Sem isso, o opt-out global de um
// teste (que e por telefone, nao por contato) vazaria para os testes seguintes.
let blocoDeNumeros = 0

/** Cria uma base com N contatos ja validados no WhatsApp. */
function seedList(nome: string, n: number): { listId: string; contactIds: string[] } {
  const list = createContactList(nome)
  const bloco = blocoDeNumeros++
  insertContacts(
    Array.from({ length: n }, (_, i) => ({
      listId: list.id,
      name: `Contato ${i + 1}`,
      phoneE164: `+5511${String(bloco).padStart(2, '0')}${String(i).padStart(7, '0')}`,
      extraJson: null
    }))
  )
  const { rows } = pageContacts(list.id, { limit: 500 })
  for (const c of rows) setWaResult(c.id, true, `${c.phoneE164.replace('+', '')}@s.whatsapp.net`)
  return { listId: list.id, contactIds: rows.map((r) => r.id) }
}

function newCampaign(listId: string, contactIds: string[], pacing = FAST): string {
  const c = createCampaign({
    name: 'Campanha teste',
    listId,
    mode: 'fixed',
    config: { text: 'Oi [nome]' },
    pacing
  })
  enqueueJobs(
    c.id,
    contactIds.map((id, i) => ({ contactId: id, renderedText: `Mensagem ${i + 1}` }))
  )
  return c.id
}

beforeAll(async () => {
  await initDb()
})

describe('motor de disparo', () => {
  it('envia para todos os contatos elegiveis e conclui', async () => {
    const { listId, contactIds } = seedList('Disparo ok', 5)
    const campaignId = newCampaign(listId, contactIds)
    const sender = makeSender()

    const reason = await campaignRunner.run(campaignId, sender)

    expect(reason).toBe('done')
    expect(sender.enviados).toHaveLength(5)
    const p = campaignProgress(campaignId)
    expect(p.sent).toBe(5)
    expect(p.pending).toBe(0)
    expect(p.status).toBe('done')
  })

  it('pula quem pediu descadastro DEPOIS de a fila ter sido montada', async () => {
    // Caso real: a pessoa responde "SAIR" enquanto a campanha esta na fila.
    const { listId, contactIds } = seedList('Disparo opt-out', 4)
    const campaignId = newCampaign(listId, contactIds)

    const { rows } = pageContacts(listId, { limit: 10 })
    addOptOut(rows[1].phoneE164, 'respondeu SAIR')
    setOptOut(rows[2].id, true)

    const sender = makeSender()
    await campaignRunner.run(campaignId, sender)

    expect(sender.enviados).toHaveLength(2)
    const p = campaignProgress(campaignId)
    expect(p.sent).toBe(2)
    expect(p.skipped).toBe(2)
  })

  it('registra falha sem abortar o resto da fila', async () => {
    const { listId, contactIds } = seedList('Disparo falha', 4)
    const campaignId = newCampaign(listId, contactIds)

    let n = 0
    const sender = makeSender({
      sendText: async () => {
        n += 1
        if (n === 2) throw new Error('rede caiu')
        return `wamid-${n}`
      }
    })

    await campaignRunner.run(campaignId, sender)
    const p = campaignProgress(campaignId)
    expect(p.sent).toBe(3)
    expect(p.failed).toBe(1)
    expect(p.pending).toBe(0)
  })

  it('para quando o WhatsApp desconecta, preservando a fila', async () => {
    const { listId, contactIds } = seedList('Disparo desconecta', 6)
    const campaignId = newCampaign(listId, contactIds)

    let conectado = true
    const sender = makeSender({
      isReady: () => conectado,
      sendText: async (jid: string) => {
        if (jid) conectado = false // cai apos o primeiro envio
        return 'wamid-1'
      }
    })

    const reason = await campaignRunner.run(campaignId, sender)
    expect(reason).toBe('disconnected')

    const p = campaignProgress(campaignId)
    expect(p.sent).toBe(1)
    // O resto continua na fila, pronto para retomar.
    expect(p.pending).toBe(5)
    expect(p.status).toBe('paused')
  })

  it('retoma de onde parou sem reenviar quem ja recebeu', async () => {
    const { listId, contactIds } = seedList('Disparo retoma', 6)
    const campaignId = newCampaign(listId, contactIds)

    let conectado = true
    let count = 0
    const s1 = makeSender({
      isReady: () => conectado,
      sendText: async () => {
        count += 1
        if (count >= 2) conectado = false
        return `wamid-${count}`
      }
    })
    await campaignRunner.run(campaignId, s1)
    expect(campaignProgress(campaignId).sent).toBe(2)

    // Retoma com a conexao de volta.
    const s2 = makeSender()
    const reason = await campaignRunner.run(campaignId, s2)

    expect(reason).toBe('done')
    // Chave do teste: apenas os 4 restantes foram enviados na segunda rodada.
    expect(s2.enviados).toHaveLength(4)
    expect(campaignProgress(campaignId).sent).toBe(6)
  })

  it('respeita o teto diario contando envios de todas as campanhas', async () => {
    const antes = sentToday()
    const { listId, contactIds } = seedList('Disparo teto', 5)
    const cap = antes + 2
    const campaignId = newCampaign(listId, contactIds, { ...FAST, dailyCap: cap })

    const sender = makeSender()
    const reason = await campaignRunner.run(campaignId, sender)

    expect(reason).toBe('dailyCap')
    expect(sender.enviados).toHaveLength(2)
    expect(campaignProgress(campaignId).pending).toBe(3)
  })

  it('nao permite duas campanhas ao mesmo tempo', async () => {
    const a = seedList('Disparo A', 2)
    const b = seedList('Disparo B', 2)
    const idA = newCampaign(a.listId, a.contactIds)
    const idB = newCampaign(b.listId, b.contactIds)

    // `!` porque o TS nao rastreia a atribuicao feita dentro do callback.
    let liberar!: () => void
    const travado = new Promise<void>((r) => {
      liberar = r
    })
    const senderA = makeSender({
      sendText: async () => {
        await travado
        return 'wamid'
      }
    })

    const execucaoA = campaignRunner.run(idA, senderA)
    await new Promise((r) => setTimeout(r, 20))
    await expect(campaignRunner.run(idB, makeSender())).rejects.toThrow(/em execucao/i)

    liberar()
    await execucaoA
  })
})

describe('recuperacao apos crash', () => {
  it('converte jobs presos em sending para unknown e NAO os reenvia', async () => {
    const { listId, contactIds } = seedList('Crash', 4)
    const campaignId = newCampaign(listId, contactIds)

    // Simula o crash: o job foi marcado como 'sending' e o processo morreu.
    const job = nextPendingJob(campaignId)
    expect(job).toBeDefined()
    markJobSending(job!.id)

    // No boot seguinte, o app reconcilia os jobs ambiguos.
    const reconciliados = reconcileStuckJobs()
    expect(reconciliados).toBeGreaterThanOrEqual(1)

    const desconhecidos = jobsByStatus(campaignId, 'unknown')
    expect(desconhecidos.map((j) => j.id)).toContain(job!.id)
    expect(desconhecidos[0].error).toMatch(/nao foi possivel confirmar/i)

    // Retomando, o job ambiguo NAO entra de novo na fila: duplicata e o que
    // mais gera denuncia e banimento.
    const sender = makeSender()
    await campaignRunner.run(campaignId, sender)

    expect(sender.enviados).toHaveLength(3) // os outros 3, nao o ambiguo
    const p = campaignProgress(campaignId)
    expect(p.unknown).toBe(1)
    expect(p.sent).toBe(3)
  })

  it('nao reenvia jobs ja marcados como sent', async () => {
    const { listId, contactIds } = seedList('Crash sent', 3)
    const campaignId = newCampaign(listId, contactIds)

    const s1 = makeSender()
    await campaignRunner.run(campaignId, s1)
    expect(s1.enviados).toHaveLength(3)

    // Rodar de novo nao deve reenviar nada.
    const s2 = makeSender()
    await campaignRunner.run(campaignId, s2)
    expect(s2.enviados).toHaveLength(0)
  })
})
