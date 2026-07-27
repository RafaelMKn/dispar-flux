/**
 * Deteccao de pedido de descadastro numa mensagem recebida.
 *
 * O app promete "responda SAIR para nao receber mais", e a LGPD espera que esse
 * pedido seja respeitado. Mas errar para o lado agressivo tambem e ruim: marcar
 * alguem como descadastrado porque escreveu "vou sair mais tarde" faz o usuario
 * perder um contato legitimo, e ele nunca vai entender o motivo.
 *
 * Por isso a regra e conservadora: a mensagem INTEIRA, normalizada, precisa ser
 * uma das palavras-chave (ou a palavra seguida de pontuacao). Frases que apenas
 * contem a palavra nao contam.
 */

const KEYWORDS = [
  'sair',
  'parar',
  'pare',
  'stop',
  'cancelar',
  'descadastrar',
  'descadastre',
  'remover',
  'remova',
  'nao quero',
  'nao quero mais',
  'nao enviar',
  'unsubscribe',
  'sair da lista',
  'me tira da lista',
  'me tire da lista'
]

/** minusculas, sem acento, sem pontuacao nas pontas, espacos colapsados. */
export function normalizeMessage(body: string): string {
  return body
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove acentos
    .toLowerCase()
    .replace(/[!.,;:?"'`´~^()[\]{}\-_*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * true se a mensagem e um pedido de descadastro.
 *
 * Exige igualdade exata com uma palavra-chave apos normalizar — e o que evita
 * o falso positivo de frases que so mencionam a palavra.
 */
export function isOptOutRequest(body: string | null | undefined): boolean {
  if (!body) return false
  const norm = normalizeMessage(body)
  if (!norm) return false
  return KEYWORDS.includes(norm)
}

/** Extrai o telefone E.164 a partir do JID do WhatsApp. */
export function jidToE164(jid: string): string | null {
  const digits = jid.split(':')[0].split('@')[0].replace(/\D/g, '')
  if (digits.length < 10) return null
  return `+${digits}`
}
