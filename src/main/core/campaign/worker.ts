import { EventEmitter } from 'node:events'
import {
  getCampaign,
  setCampaignStatus,
  nextPendingJob,
  markJobSending,
  markJobSent,
  markJobFailed,
  markJobSkipped,
  campaignProgress,
  sentToday,
  runningCampaign,
  type CampaignProgress
} from '../../repos/campaigns'
import { getContact } from '../../repos/contacts'
import { getOptOutSet } from '../../repos/optOuts'
import { scoped } from '../../logger'

const log = scoped('campaign')

/**
 * Motor de disparo.
 *
 * Consome a fila persistente `campaign_jobs`. Toda a resiliencia vem de a fila
 * estar no banco: fechar o app, cair a conexao ou travar a maquina nao perde o
 * progresso, e retomar continua de onde parou sem reenviar nada.
 */

/** O envio e injetado para o teste rodar sem WhatsApp de verdade. */
export interface Sender {
  isReady: () => boolean
  sendTyping: (jid: string, ms: number) => Promise<void>
  sendText: (jid: string, text: string) => Promise<string | null>
}

export type StopReason = 'done' | 'paused' | 'canceled' | 'disconnected' | 'dailyCap' | 'error'

export const campaignEvents = new EventEmitter()

function randomBetween(min: number, max: number): number {
  const lo = Math.max(0, Math.min(min, max))
  const hi = Math.max(0, Math.max(min, max))
  return Math.floor(lo + Math.random() * (hi - lo + 1))
}

class CampaignRunner {
  private running: string | null = null
  private cancelRequested = false
  private pauseRequested = false
  private sleepTimer: ReturnType<typeof setTimeout> | null = null
  private wake: (() => void) | null = null

  get activeCampaignId(): string | null {
    return this.running
  }

  /** Sleep interrompivel: pausar/cancelar nao espera o intervalo terminar. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.wake = resolve
      this.sleepTimer = setTimeout(() => {
        this.wake = null
        resolve()
      }, ms)
    })
  }

  private interruptSleep(): void {
    if (this.sleepTimer) clearTimeout(this.sleepTimer)
    this.sleepTimer = null
    if (this.wake) {
      const w = this.wake
      this.wake = null
      w()
    }
  }

  private emitProgress(campaignId: string): void {
    campaignEvents.emit('progress', campaignProgress(campaignId))
  }

  pause(): void {
    if (!this.running) return
    this.pauseRequested = true
    this.interruptSleep()
  }

  cancel(): void {
    if (!this.running) return
    this.cancelRequested = true
    this.interruptSleep()
  }

  /**
   * Executa a campanha ate acabar a fila, pausar, cancelar, cair a conexao ou
   * bater o teto diario.
   */
  async run(campaignId: string, sender: Sender): Promise<StopReason> {
    if (this.running) {
      throw new Error('Ja existe uma campanha em execucao. Pause antes de iniciar outra.')
    }
    const campaign = getCampaign(campaignId)
    if (!campaign) throw new Error('Campanha nao encontrada.')

    this.running = campaignId
    this.cancelRequested = false
    this.pauseRequested = false
    setCampaignStatus(campaignId, 'running')
    log.info('campanha iniciada', { campaignId, nome: campaign.name })

    let reason: StopReason = 'done'
    let sentInThisRun = 0

    try {
      for (;;) {
        if (this.cancelRequested) {
          reason = 'canceled'
          break
        }
        if (this.pauseRequested) {
          reason = 'paused'
          break
        }
        if (!sender.isReady()) {
          reason = 'disconnected'
          break
        }

        // Teto diario conta TODAS as campanhas do dia, lido do banco.
        if (campaign.dailyCap > 0 && sentToday() >= campaign.dailyCap) {
          reason = 'dailyCap'
          break
        }

        const job = nextPendingJob(campaignId)
        if (!job) {
          reason = 'done'
          break
        }

        const contact = getContact(job.contactId)
        if (!contact) {
          markJobSkipped(job.id, 'Contato removido da base.')
          this.emitProgress(campaignId)
          continue
        }

        // Reconfere o opt-out AGORA: o contato pode ter respondido "SAIR"
        // depois de a fila ter sido montada.
        if (contact.optOut === 1 || getOptOutSet([contact.phoneE164]).has(contact.phoneE164)) {
          markJobSkipped(job.id, 'Contato pediu descadastro.')
          this.emitProgress(campaignId)
          continue
        }
        if (contact.waValid === 0) {
          markJobSkipped(job.id, 'Numero nao existe no WhatsApp.')
          this.emitProgress(campaignId)
          continue
        }

        // Sempre o jid devolvido pela API; nunca montado a mao (9o digito).
        const jid = contact.jid
        if (!jid) {
          markJobSkipped(job.id, 'Numero ainda nao validado no WhatsApp.')
          this.emitProgress(campaignId)
          continue
        }

        const text = job.renderedText ?? ''
        if (!text.trim()) {
          markJobSkipped(job.id, 'Mensagem vazia.')
          this.emitProgress(campaignId)
          continue
        }

        markJobSending(job.id)
        try {
          // "digitando" antes de enviar deixa o envio menos mecanico.
          await sender.sendTyping(jid, Math.min(2500, randomBetween(900, 2500)))
          const waId = await sender.sendText(jid, text)
          markJobSent(job.id, waId)
          sentInThisRun += 1
          log.info('enviado', { jid, jobId: job.id })
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          markJobFailed(job.id, msg)
          log.warn('falha no envio', { jid, erro: msg })
        }

        this.emitProgress(campaignId)

        // Descanso a cada N envios.
        if (
          campaign.restEveryN > 0 &&
          sentInThisRun > 0 &&
          sentInThisRun % campaign.restEveryN === 0 &&
          campaign.restDurationMs > 0
        ) {
          log.info('descanso', { apos: sentInThisRun, ms: campaign.restDurationMs })
          campaignEvents.emit('resting', { campaignId, untilMs: Date.now() + campaign.restDurationMs })
          await this.sleep(campaign.restDurationMs)
          continue
        }

        // Intervalo aleatorio (nunca fixo: cadencia constante e assinatura de bot).
        await this.sleep(randomBetween(campaign.delayMinMs, campaign.delayMaxMs))
      }
    } finally {
      const finalStatus =
        reason === 'done' ? 'done' : reason === 'canceled' ? 'canceled' : 'paused'
      setCampaignStatus(campaignId, finalStatus)
      this.running = null
      this.pauseRequested = false
      this.cancelRequested = false
      this.emitProgress(campaignId)
      log.info('campanha encerrada', { campaignId, reason, enviadosNestaExecucao: sentInThisRun })
      campaignEvents.emit('stopped', { campaignId, reason })
    }

    return reason
  }
}

export const campaignRunner = new CampaignRunner()

/** Se o app caiu com uma campanha 'running', ela nao esta mais rodando. */
export function reconcileRunningCampaign(): string | null {
  const c = runningCampaign()
  if (!c) return null
  setCampaignStatus(c.id, 'paused')
  log.warn('campanha estava marcada como em execucao no boot; marcada como pausada', {
    campaignId: c.id
  })
  return c.id
}

export type { CampaignProgress }
