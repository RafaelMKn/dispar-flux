/**
 * Formata o JID do Baileys como telefone legivel.
 *
 * "555181360431@s.whatsapp.net" -> "+55 51 8136-0431"
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
