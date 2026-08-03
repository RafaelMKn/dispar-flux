import { describe, it, expect } from 'vitest'
import {
  isWithinWindow,
  nextWindowOpening,
  isAutomaticReply,
  isLeadDue,
  leadDueAt,
  type TimeWindow
} from './rules'

/** Horario local, para os testes lerem como o usuario pensa. */
function at(iso: string): number {
  return new Date(iso).getTime()
}

const HOUR = 3_600_000
const WEEKDAYS_9_TO_18: TimeWindow = {
  weekdays: [1, 2, 3, 4, 5],
  startMinute: 9 * 60,
  endMinute: 18 * 60
}

describe('isWithinWindow', () => {
  it('aceita horario comercial em dia util', () => {
    // 2026-08-05 e uma quarta-feira.
    expect(isWithinWindow(at('2026-08-05T10:00:00'), WEEKDAYS_9_TO_18)).toBe(true)
  })

  it('recusa antes de abrir e a partir do fechamento', () => {
    expect(isWithinWindow(at('2026-08-05T08:59:00'), WEEKDAYS_9_TO_18)).toBe(false)
    expect(isWithinWindow(at('2026-08-05T18:00:00'), WEEKDAYS_9_TO_18)).toBe(false)
  })

  it('recusa fim de semana mesmo dentro do horario', () => {
    // 2026-08-08 e um sabado.
    expect(isWithinWindow(at('2026-08-08T10:00:00'), WEEKDAYS_9_TO_18)).toBe(false)
  })

  it('nunca abre sem dia marcado', () => {
    expect(isWithinWindow(at('2026-08-05T10:00:00'), { ...WEEKDAYS_9_TO_18, weekdays: [] })).toBe(
      false
    )
  })

  it('trata start igual a end como dia inteiro', () => {
    const allDay: TimeWindow = { weekdays: [3], startMinute: 0, endMinute: 0 }
    expect(isWithinWindow(at('2026-08-05T03:00:00'), allDay)).toBe(true)
    expect(isWithinWindow(at('2026-08-05T23:30:00'), allDay)).toBe(true)
  })

  describe('janela que cruza a meia-noite', () => {
    // Sexta 22:00 -> 02:00. So sexta esta marcada.
    const nightly: TimeWindow = { weekdays: [5], startMinute: 22 * 60, endMinute: 2 * 60 }

    it('aceita a noite do dia marcado', () => {
      expect(isWithinWindow(at('2026-08-07T23:00:00'), nightly)).toBe(true)
    })

    it('aceita a madrugada seguinte, que pertence a sexta', () => {
      expect(isWithinWindow(at('2026-08-08T01:00:00'), nightly)).toBe(true)
    })

    it('recusa a madrugada de domingo, cujo dia anterior nao esta marcado', () => {
      expect(isWithinWindow(at('2026-08-09T01:00:00'), nightly)).toBe(false)
    })
  })
})

describe('nextWindowOpening', () => {
  it('devolve o proprio instante quando ja esta aberta', () => {
    const now = at('2026-08-05T10:00:00')
    expect(nextWindowOpening(now, WEEKDAYS_9_TO_18)).toBe(now)
  })

  it('abre no mesmo dia quando ainda e cedo', () => {
    expect(nextWindowOpening(at('2026-08-05T07:00:00'), WEEKDAYS_9_TO_18)).toBe(
      at('2026-08-05T09:00:00')
    )
  })

  it('pula para o dia seguinte depois do fechamento', () => {
    expect(nextWindowOpening(at('2026-08-05T19:00:00'), WEEKDAYS_9_TO_18)).toBe(
      at('2026-08-06T09:00:00')
    )
  })

  it('pula o fim de semana inteiro', () => {
    // Sabado de manha -> segunda 09:00.
    expect(nextWindowOpening(at('2026-08-08T08:00:00'), WEEKDAYS_9_TO_18)).toBe(
      at('2026-08-10T09:00:00')
    )
  })
})

describe('isAutomaticReply', () => {
  const sent = at('2026-08-05T10:00:00')

  it('descarta a resposta que chega dentro da janela', () => {
    expect(isAutomaticReply(sent, sent + 400, 1000)).toBe(true)
    expect(isAutomaticReply(sent, sent + 1000, 1000)).toBe(true)
  })

  it('aceita a resposta que chega depois da janela', () => {
    expect(isAutomaticReply(sent, sent + 1001, 1000)).toBe(false)
  })

  it('fica desligada com janela zero', () => {
    expect(isAutomaticReply(sent, sent + 10, 0)).toBe(false)
  })

  it('nao decide sem saber quando enviamos', () => {
    expect(isAutomaticReply(null, sent, 1000)).toBe(false)
  })

  it('nao descarta resposta quando o relogio andou para tras', () => {
    expect(isAutomaticReply(sent, sent - 5000, 1000)).toBe(false)
  })
})

describe('isLeadDue', () => {
  const timing = { afterHours: 48, maxFollowUps: 2 }
  const sentAt = at('2026-08-01T10:00:00')

  it('pega quem nao respondeu depois do prazo', () => {
    const lead = { firstSentAt: sentAt, firstReplyAt: null, lastFollowUpAt: null, followUps: 0 }
    expect(isLeadDue(lead, timing, sentAt + 48 * HOUR)).toBe(true)
  })

  it('espera o prazo completo', () => {
    const lead = { firstSentAt: sentAt, firstReplyAt: null, lastFollowUpAt: null, followUps: 0 }
    expect(isLeadDue(lead, timing, sentAt + 47 * HOUR)).toBe(false)
  })

  it('nunca pega quem ja respondeu', () => {
    const lead = {
      firstSentAt: sentAt,
      firstReplyAt: sentAt + HOUR,
      lastFollowUpAt: null,
      followUps: 0
    }
    expect(isLeadDue(lead, timing, sentAt + 999 * HOUR)).toBe(false)
  })

  it('respeita o teto de follow-ups', () => {
    const lead = {
      firstSentAt: sentAt,
      firstReplyAt: null,
      lastFollowUpAt: sentAt + 48 * HOUR,
      followUps: 2
    }
    expect(isLeadDue(lead, timing, sentAt + 999 * HOUR)).toBe(false)
  })

  it('conta o prazo a partir do ultimo follow-up, nao do envio original', () => {
    const lead = {
      firstSentAt: sentAt,
      firstReplyAt: null,
      lastFollowUpAt: sentAt + 48 * HOUR,
      followUps: 1
    }
    // Ja passaram 72h do envio, mas so 24h do ultimo follow-up.
    expect(isLeadDue(lead, timing, sentAt + 72 * HOUR)).toBe(false)
    expect(isLeadDue(lead, timing, sentAt + 96 * HOUR)).toBe(true)
  })

  it('ignora lead que nunca recebeu nada', () => {
    const lead = { firstSentAt: null, firstReplyAt: null, lastFollowUpAt: null, followUps: 0 }
    expect(isLeadDue(lead, timing, Date.now())).toBe(false)
  })
})

describe('leadDueAt', () => {
  const timing = { afterHours: 24, maxFollowUps: 3 }
  const sentAt = at('2026-08-01T10:00:00')

  it('projeta a partir do ultimo contato nosso', () => {
    expect(
      leadDueAt(
        { firstSentAt: sentAt, firstReplyAt: null, lastFollowUpAt: null, followUps: 0 },
        timing
      )
    ).toBe(sentAt + 24 * HOUR)
  })

  it('nao projeta nada para quem respondeu ou estourou o teto', () => {
    expect(
      leadDueAt(
        { firstSentAt: sentAt, firstReplyAt: sentAt + HOUR, lastFollowUpAt: null, followUps: 0 },
        timing
      )
    ).toBeNull()
    expect(
      leadDueAt(
        { firstSentAt: sentAt, firstReplyAt: null, lastFollowUpAt: sentAt, followUps: 3 },
        timing
      )
    ).toBeNull()
  })
})
