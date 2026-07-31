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
