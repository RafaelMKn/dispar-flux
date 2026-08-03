/**
 * Regras puras do CRM: janela anti-resposta-automatica e elegibilidade do
 * follow-up.
 *
 * Vive separado do banco e do Electron de proposito — sao as decisoes que
 * determinam se uma mensagem vira "cliente respondeu" e se alguem recebe outro
 * disparo. Testar isso com o app rodando seria inviavel.
 */

export interface TimeWindow {
  /** Dias permitidos, 0 = domingo. Vazio = nunca abre. */
  weekdays: number[]
  /** Minutos desde a meia-noite local. */
  startMinute: number
  endMinute: number
}

/**
 * A janela esta aberta neste instante?
 *
 * `start === end` significa o dia inteiro. Quando `end < start` a janela cruza a
 * meia-noite, e o trecho da madrugada pertence ao dia em que ela ABRIU — senao
 * uma janela "sex 22:00-02:00" mandaria mensagem no sabado de madrugada mesmo
 * com sabado desmarcado.
 */
export function isWithinWindow(at: number, window: TimeWindow): boolean {
  if (window.weekdays.length === 0) return false
  const d = new Date(at)
  const minute = d.getHours() * 60 + d.getMinutes()
  const day = d.getDay()
  const { startMinute: start, endMinute: end } = window

  if (start === end) return window.weekdays.includes(day)
  if (start < end) return window.weekdays.includes(day) && minute >= start && minute < end

  if (minute >= start) return window.weekdays.includes(day)
  const previousDay = (day + 6) % 7
  return minute < end && window.weekdays.includes(previousDay)
}

/**
 * Proximo instante em que a janela abre. Devolve `from` se ja esta aberta.
 *
 * Varre no maximo 8 dias: com sete dias da semana, se nenhum serve e porque a
 * regra nao tem dia marcado, e ai nao ha resposta melhor do que "agora".
 */
export function nextWindowOpening(from: number, window: TimeWindow): number {
  if (window.weekdays.length === 0) return from
  if (isWithinWindow(from, window)) return from

  const base = new Date(from)
  const hour = Math.floor(window.startMinute / 60)
  const minute = window.startMinute % 60
  for (let offset = 0; offset <= 8; offset++) {
    const candidate = new Date(
      base.getFullYear(),
      base.getMonth(),
      base.getDate() + offset,
      hour,
      minute,
      0,
      0
    )
    if (candidate.getTime() >= from && window.weekdays.includes(candidate.getDay())) {
      return candidate.getTime()
    }
  }
  return from
}

/**
 * A resposta chegou rapido demais para ser humana?
 *
 * IMPORTANTE — qual relogio usar. `receivedAt` deve ser o instante em que o app
 * processou a mensagem (`Date.now()`), NAO o `messageTimestamp` do WhatsApp: o
 * timestamp do WhatsApp vem em segundos inteiros e de outro relogio, entao
 * comparado com o nosso `sentAt` em milissegundos ele erra ate ~1s justamente na
 * faixa que esta regra precisa distinguir.
 *
 * `windowMs <= 0` desliga a regra.
 */
export function isAutomaticReply(
  sentAt: number | null | undefined,
  receivedAt: number,
  windowMs: number
): boolean {
  if (windowMs <= 0) return false
  if (sentAt == null) return false
  const delta = receivedAt - sentAt
  // delta negativo = relogio andou para tras entre o envio e o recebimento.
  // Nao da para afirmar que foi automatica, e o erro caro aqui e descartar uma
  // resposta de verdade.
  if (delta < 0) return false
  return delta <= windowMs
}

export interface FollowUpCandidate {
  firstSentAt: number | null
  firstReplyAt: number | null
  lastFollowUpAt: number | null
  followUps: number
}

export interface FollowUpTiming {
  afterHours: number
  maxFollowUps: number
}

/**
 * O lead esta na hora de receber (mais um) follow-up?
 *
 * A contagem parte do ULTIMO contato nosso — `lastFollowUpAt` quando ja houve
 * follow-up, senao o envio original. E o que faz "a cada 2 dias, ate 3 vezes"
 * virar tres mensagens espacadas, e nao tres de uma vez no segundo dia.
 *
 * Nao trata opt-out nem numero invalido: isso o motor de disparo reconfere no
 * instante do envio, que e onde a informacao esta mais fresca.
 */
export function isLeadDue(lead: FollowUpCandidate, timing: FollowUpTiming, now: number): boolean {
  if (lead.firstReplyAt != null) return false
  if (lead.followUps >= timing.maxFollowUps) return false
  const lastTouch = lead.lastFollowUpAt ?? lead.firstSentAt
  if (lastTouch == null) return false
  return now - lastTouch >= timing.afterHours * 3_600_000
}

/** Quando o lead ficaria elegivel, ignorando a janela de horario. */
export function leadDueAt(lead: FollowUpCandidate, timing: FollowUpTiming): number | null {
  if (lead.firstReplyAt != null) return null
  if (lead.followUps >= timing.maxFollowUps) return null
  const lastTouch = lead.lastFollowUpAt ?? lead.firstSentAt
  if (lastTouch == null) return null
  return lastTouch + timing.afterHours * 3_600_000
}
