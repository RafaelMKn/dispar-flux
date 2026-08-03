/**
 * Formata o JID do Baileys como telefone legivel.
 *
 * "555132554210@s.whatsapp.net" -> "+55 51 3255-4210"
 * "5511987654210:12@s.whatsapp.net" -> "+55 11 98765-4210"
 *
 * Abaixo de 12 digitos nao da para separar DDI/DDD com seguranca, entao devolve
 * so os digitos com "+" — melhor um numero cru do que um numero errado.
 */
export function formatJid(jid: string): string {
  const d = jid.split(':')[0].split('@')[0].replace(/\D/g, '')
  if (d.length < 12) return `+${d}`
  return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, d.length - 4)}-${d.slice(-4)}`
}

/** Tamanho de arquivo legivel: 2.4 MB, 812 KB. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** Duracao de audio no formato m:ss. */
export function formatDuration(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.round(seconds ?? 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/**
 * Ha quanto tempo, em texto curto: "agora", "3 h", "5 d".
 *
 * O CRM vive de responder "esse lead esta parado ha quanto tempo?", e nessa
 * pergunta a data exata atrapalha: "12/03 14:32" obriga o usuario a fazer a
 * conta que o cartao deveria ter feito por ele.
 */
export function formatElapsed(ts: number | null | undefined, now = Date.now()): string {
  if (ts == null) return '—'
  const diff = Math.max(0, now - ts)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'agora'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours} h`
  return `${Math.floor(hours / 24)} d`
}

/** Data e hora curtas, no formato que o resto do app usa. */
export function formatDateTime(ts: number | null | undefined): string {
  if (ts == null) return '—'
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Minutos desde a meia-noite -> "09:30". */
export function formatMinuteOfDay(minute: number): string {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** "09:30" -> minutos desde a meia-noite. null quando o texto nao e um horario. */
export function parseMinuteOfDay(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** Iniciais para o avatar de quem nao tem foto. */
export function initialsFor(name: string | null, jid: string): string {
  const source = (name ?? '').trim()
  if (source) {
    const parts = source.split(/\s+/).filter(Boolean)
    const letters =
      parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)
    return letters.toUpperCase()
  }
  // Sem nome, as iniciais do telefone nao dizem nada; os ultimos digitos sim.
  return jid.split('@')[0].replace(/\D/g, '').slice(-2) || '?'
}
