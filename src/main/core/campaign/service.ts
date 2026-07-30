import {
  createCampaign,
  enqueueJobs,
  eligibleContacts,
  campaignProgress,
  contactIdsAlreadySent
} from '../../repos/campaigns'
import { getOptOutSet } from '../../repos/optOuts'
import { whatsapp } from '../whatsapp/client'
import { campaignRunner, type Sender } from './worker'
import { renderFixed, renderRotate, renderParagraph, type RenderContext } from '../messages/render'
import { scoped } from '../../logger'
import type {
  MessageMode,
  SendingDefaults,
  CampaignPlan,
  CampaignProgress,
  MessageConfig
} from '@shared/types'

const log = scoped('campaign')

/** Sender real, ligado ao Baileys. */
const liveSender: Sender = {
  isReady: () => Boolean(whatsapp.socket),
  sendTyping: (jid, ms) => whatsapp.sendTyping(jid, ms),
  sendText: (jid, text) => whatsapp.sendText(jid, text)
}

function parseExtras(extraJson: string | null): Record<string, string> {
  if (!extraJson) return {}
  try {
    const o = JSON.parse(extraJson) as Record<string, unknown>
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v ?? '')]))
  } catch {
    return {}
  }
}

function renderFor(mode: MessageMode, config: MessageConfig, ctx: RenderContext): string {
  switch (mode) {
    case 'fixed':
      return renderFixed(config.text ?? '', ctx)
    case 'rotate':
      return renderRotate(config.messages ?? [], ctx)
    case 'paragraph':
      return renderParagraph({ pools: config.pools ?? [] }, ctx)
    case 'ai':
      // Modo IA e Fase 3; a UI mantem o cartao desabilitado.
      throw new Error('O modo IA ainda nao esta disponivel.')
  }
}

/**
 * Monta o plano da campanha: quem entra, quem fica de fora e por que, mais
 * amostras ja renderizadas para o usuario revisar ANTES de disparar.
 */
export function planCampaign(
  listId: string,
  mode: MessageMode,
  config: MessageConfig,
  skipAlreadySent = false
): CampaignPlan {
  const all = eligibleContacts(listId)
  const optedOut = getOptOutSet(all.map((c) => c.phoneE164))
  const alreadySent = skipAlreadySent ? contactIdsAlreadySent(listId) : null

  // Sempre 0: `eligibleContacts` nao separa "numero nao existe no WhatsApp"
  // (waValid = 0) de "ainda nao verificado" (waValid = null), entao os dois
  // caem em skippedUnchecked abaixo. O campo fica no contrato por enquanto —
  // corrigir a contagem muda o que o usuario le na previa, e isso e mudanca
  // de comportamento, nao limpeza.
  const skippedInvalid = 0
  let skippedUnchecked = 0
  let skippedOptOut = 0
  let skippedAlreadySent = 0
  const targets: typeof all = []

  for (const c of all) {
    if (optedOut.has(c.phoneE164)) {
      skippedOptOut += 1
      continue
    }
    if (!c.jid) {
      // Sem jid confirmado nao ha como enviar com seguranca (9o digito).
      skippedUnchecked += 1
      continue
    }
    if (alreadySent?.has(c.id)) {
      skippedAlreadySent += 1
      continue
    }
    targets.push(c)
  }

  const samples: string[] = []
  for (let i = 0; i < Math.min(3, targets.length); i++) {
    const c = targets[i]
    try {
      samples.push(
        renderFor(mode, config, {
          name: c.name,
          extras: parseExtras(c.extraJson),
          index: i
        })
      )
    } catch {
      // Erro de configuracao aparece na validacao, nao aqui.
    }
  }

  return {
    listId,
    eligible: targets.length,
    skippedInvalid,
    skippedUnchecked,
    skippedOptOut,
    skippedAlreadySent,
    samples
  }
}

/**
 * Cria a campanha, renderiza a mensagem de cada contato e enfileira.
 *
 * A renderizacao acontece AQUI (nao no envio) para o texto ficar gravado em
 * `campaign_jobs.rendered_text`: retomar depois de um crash reenvia exatamente
 * o que seria enviado antes, e o usuario pode auditar o que foi mandado.
 */
export function startCampaign(input: {
  name: string
  listId: string
  mode: MessageMode
  config: MessageConfig
  pacing: SendingDefaults
  /** Nao reenvia para quem ja recebeu mensagem em campanha anterior desta base. */
  skipAlreadySent?: boolean
}): { campaignId: string; queued: number } {
  const all = eligibleContacts(input.listId)
  const optedOut = getOptOutSet(all.map((c) => c.phoneE164))
  const alreadySent = input.skipAlreadySent ? contactIdsAlreadySent(input.listId) : null
  const targets = all.filter((c) => c.jid && !optedOut.has(c.phoneE164) && !alreadySent?.has(c.id))

  if (targets.length === 0) {
    throw new Error(
      input.skipAlreadySent
        ? 'Nenhum contato elegivel: todos ja receberam mensagem antes, foram validados ou estao descadastrados.'
        : 'Nenhum contato elegivel. Valide os numeros no WhatsApp e confira os descadastros.'
    )
  }

  const campaign = createCampaign({
    name: input.name,
    listId: input.listId,
    mode: input.mode,
    config: input.config,
    pacing: input.pacing
  })

  const jobs = targets.map((c, index) => ({
    contactId: c.id,
    renderedText: renderFor(input.mode, input.config, {
      name: c.name,
      extras: parseExtras(c.extraJson),
      index
    })
  }))

  const queued = enqueueJobs(campaign.id, jobs)
  log.info('campanha enfileirada', { campaignId: campaign.id, queued })

  // Roda em background: o IPC responde na hora e o progresso vai por evento.
  void campaignRunner.run(campaign.id, liveSender).catch((e: unknown) => {
    log.error('erro na execucao da campanha', e)
  })

  return { campaignId: campaign.id, queued }
}

/** Retoma uma campanha pausada, sem reenviar o que ja saiu. */
export function resumeCampaign(campaignId: string): void {
  void campaignRunner.run(campaignId, liveSender).catch((e: unknown) => {
    log.error('erro ao retomar campanha', e)
  })
}

export function pauseCampaign(): void {
  campaignRunner.pause()
}

export function cancelCampaign(): void {
  campaignRunner.cancel()
}

export function progressOf(campaignId: string): CampaignProgress {
  return campaignProgress(campaignId)
}
